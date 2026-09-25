import { readFileSync } from 'node:fs'
import { app, inAppPurchase, type BrowserWindow, type Product, type Transaction } from 'electron'
import { lightyuServiceToken, saveLightyuGuest } from './lightyu-auth'

const API_BASE_URL = 'https://5555api.com'
export const APPLE_IAP_PRODUCT_ID = 'JD'

/** Consumable top-up catalog. Product IDs must match App Store Connect. */
export const APPLE_IAP_PRODUCTS: Readonly<Record<string, number>> = {
  JD: 2_000,
  JD4200: 4_200,
  JD13200: 13_200,
  JD23000: 23_000,
  JD55000: 55_000,
  JD110000: 110_000,
}

export interface AppleIapProduct {
  id: string
  title: string
  description: string
  formattedPrice: string
  price: number
  currencyCode: string
  beans: number
}

export type AppleIapEvent =
  | { phase: 'purchasing' | 'deferred'; productId: string }
  | {
      phase: 'success'
      productId: string
      transactionId: string
      beansAdded: number
      balance: number
    }
  | { phase: 'failed'; productId: string; error: string }

interface AppleIapVerificationData {
  beansAdded?: number
  balance?: number
  guestToken?: string
  guestExpire?: number
}

const IAP_RETRY_DELAYS_MS = [0, 750, 1_750, 3_500] as const

let initialized = false
let windowProvider: (() => BrowserWindow | null) | null = null
const processingTransactions = new Set<string>()

/** StoreKit is only available in Mac App Store and TestFlight builds. */
function isMacAppStoreBuild(): boolean {
  return process.platform === 'darwin' && process.mas
}

function emit(event: AppleIapEvent): void {
  const win = windowProvider?.()
  if (win && !win.isDestroyed()) win.webContents.send('home:apple-iap-event', event)
}

function productToApi(product: Product): AppleIapProduct {
  return {
    id: product.productIdentifier,
    title: product.localizedTitle,
    description: product.localizedDescription,
    formattedPrice: product.formattedPrice,
    price: product.price,
    currencyCode: product.currencyCode,
    beans: APPLE_IAP_PRODUCTS[product.productIdentifier] ?? 0,
  }
}

async function readReceiptData(): Promise<string> {
  const receiptUrl = inAppPurchase.getReceiptURL()
  if (!receiptUrl) throw new Error('Apple 交易回执不存在')
  const receipt = readFileSync(receiptUrl)
  if (!receipt.length || receipt.length > 4 * 1024 * 1024) throw new Error('Apple 交易回执无效')
  return receipt.toString('base64')
}

async function verifyTransaction(
  productId: string,
  transactionId: string,
  originalTransactionId: string | undefined,
  token: string | null,
): Promise<AppleIapVerificationData> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = token
  let lastError = '充值校验失败，请稍后重试'

  for (let attempt = 0; attempt < IAP_RETRY_DELAYS_MS.length; attempt++) {
    const delay = IAP_RETRY_DELAYS_MS[attempt]
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    try {
      const receiptData = await readReceiptData()
      const response = await fetch(`${API_BASE_URL}/data/user/apple/iap`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId, transactionId, originalTransactionId, receiptData }),
        signal: AbortSignal.timeout(20_000),
      })
      const result = (await response.json().catch(() => null)) as {
        code?: number
        msg?: string
        message?: string
        data?: AppleIapVerificationData
      } | null
      if (response.ok && result?.code === 200 && result.data) return result.data

      lastError = result?.msg || result?.message || `充值服务错误（${response.status}）`
      if (!isRetryableIapError(lastError, response.status)) break
    } catch (error) {
      lastError = formatIapError(error)
      if (!isRetryableIapError(lastError)) break
    }
  }
  throw new Error(lastError)
}

function formatIapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|network|timeout|timed out|aborted/i.test(message)) {
    return '暂时无法连接内购服务，请稍后重试'
  }
  return message || '充值校验失败，请稍后重试'
}

function isRetryableIapError(message: string, status?: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    (typeof status === 'number' && status >= 500) ||
    /暂时无法连接内购服务|回执中的商品或交易号不匹配/i.test(message)
  )
}

async function settleTransaction(transaction: Transaction): Promise<void> {
  const productId = transaction.payment.productIdentifier || APPLE_IAP_PRODUCT_ID
  if (
    transaction.transactionState === 'purchasing' ||
    transaction.transactionState === 'deferred'
  ) {
    emit({ phase: transaction.transactionState, productId })
    return
  }
  if (transaction.transactionState === 'failed') {
    inAppPurchase.finishTransactionByDate(transaction.transactionDate)
    emit({ phase: 'failed', productId, error: transaction.errorMessage || 'Apple 交易失败' })
    return
  }
  if (!['purchased', 'restored'].includes(transaction.transactionState)) return
  const transactionId = transaction.transactionIdentifier
  if (!transactionId || processingTransactions.has(transactionId)) return
  processingTransactions.add(transactionId)
  try {
    const token = lightyuServiceToken()
    const verified = await verifyTransaction(
      productId,
      transactionId,
      transaction.originalTransactionIdentifier,
      token,
    )
    if (typeof verified.guestToken === 'string' && typeof verified.guestExpire === 'number') {
      saveLightyuGuest(verified.guestToken, verified.guestExpire)
    }
    inAppPurchase.finishTransactionByDate(transaction.transactionDate)
    emit({
      phase: 'success',
      productId,
      transactionId,
      beansAdded: Number(verified.beansAdded ?? APPLE_IAP_PRODUCTS[productId] ?? 0),
      balance: Number(verified.balance ?? 0),
    })
  } catch (error) {
    emit({
      phase: 'failed',
      productId,
      error: formatIapError(error),
    })
  } finally {
    processingTransactions.delete(transactionId)
  }
}

export function registerAppleIap(provider: () => BrowserWindow | null): void {
  if (!isMacAppStoreBuild() || initialized) return
  initialized = true
  windowProvider = provider
  inAppPurchase.on('transactions-updated', (_event, transactions) => {
    for (const transaction of transactions) void settleTransaction(transaction)
  })
}

export async function appleIapProducts(): Promise<AppleIapProduct[]> {
  if (!isMacAppStoreBuild()) return []
  const products = await inAppPurchase.getProducts(Object.keys(APPLE_IAP_PRODUCTS))
  return products
    .filter((product) => Object.hasOwn(APPLE_IAP_PRODUCTS, product.productIdentifier))
    .map(productToApi)
    .sort((a, b) => a.beans - b.beans)
}

export async function appleIapPurchase(
  productId = APPLE_IAP_PRODUCT_ID,
): Promise<{ started: boolean; error?: string }> {
  if (!isMacAppStoreBuild())
    return { started: false, error: '请从 App Store 或 TestFlight 安装 AiOffice 后使用 Apple 内购' }
  if (!Object.hasOwn(APPLE_IAP_PRODUCTS, productId))
    return { started: false, error: '内购套餐无效' }
  try {
    const products = await appleIapProducts()
    if (!products.length)
      return {
        started: false,
        error: '内购商品暂不可用，请从 App Store 或 TestFlight 运行 AiOffice',
      }
    if (!inAppPurchase.canMakePayments())
      return { started: false, error: '当前 Apple 账户不允许内购' }
    const accepted = await inAppPurchase.purchaseProduct(productId, { quantity: 1 })
    return accepted ? { started: true } : { started: false, error: 'Apple 未接受本次购买' }
  } catch (error) {
    return { started: false, error: error instanceof Error ? error.message : '无法发起 Apple 内购' }
  }
}

export function restoreAppleIap(): void {
  if (isMacAppStoreBuild()) inAppPurchase.restoreCompletedTransactions()
}

export function appleIapAvailable(): boolean {
  return isMacAppStoreBuild() && app.isReady()
}
