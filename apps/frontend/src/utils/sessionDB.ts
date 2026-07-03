import { getCurrentStorageScope } from '@/utils/storageScope'

const DB_NAME_PREFIX = 'AppServerSessionDB'
const DB_VERSION = 2

interface StoreConfig {
  name: string
  keyPath: string
  indexes?: { name: string; keyPath: string; unique: boolean }[]
}

const STORES = [
  {
    name: 'balanceTransactions',
    keyPath: 'id',
    indexes: [{ name: 'createTime', keyPath: 'createTime', unique: false }],
  },
  {
    name: 'sessionMeta',
    keyPath: 'key',
    indexes: [],
  },
] as const satisfies StoreConfig[]

class SessionDB {
  private db: IDBDatabase | null = null
  private activeDbName: string | null = null

  private getDbName(): string {
    return `${DB_NAME_PREFIX}::${getCurrentStorageScope()}`
  }

  async init(): Promise<void> {
    const dbName = this.getDbName()
    if (this.db && this.activeDbName === dbName) return

    if (this.db && this.activeDbName !== dbName) {
      this.db.close()
      this.db = null
      this.activeDbName = null
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        this.activeDbName = dbName
        resolve()
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        STORES.forEach((config) => {
          if (!db.objectStoreNames.contains(config.name)) {
            const store = db.createObjectStore(config.name, { keyPath: config.keyPath })
            config.indexes?.forEach((idx) =>
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique }),
            )
          }
        })
      }
    })
  }

  async save<T>(storeName: string, data: T[]): Promise<void> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    data.forEach((item) => store.put(JSON.parse(JSON.stringify(item))))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async setItem<T>(storeName: string, key: string, value: T): Promise<void> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.put({
      key,
      value: JSON.parse(JSON.stringify(value)),
    })
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getItem<T>(storeName: string, key: string): Promise<T | undefined> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    return new Promise((resolve, reject) => {
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result?.value as T | undefined)
      request.onerror = () => reject(request.error)
    })
  }

  async removeItem(storeName: string, key: string): Promise<void> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.delete(key)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection = 'next',
  ): Promise<T[]> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const index = store.index(indexName)

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, direction)
      const results: T[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
        if (cursor) {
          results.push(cursor.value as T)
          cursor.continue()
        } else {
          resolve(results)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getRecent<T>(storeName: string, limit: number): Promise<T[]> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const index = store.index('createTime')
    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev')
      const results: T[] = []
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor && results.length < limit) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clear(storeName: string): Promise<void> {
    if (!this.db) await this.init()
    const tx = this.db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    return new Promise((resolve, reject) => {
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteDB(): Promise<void> {
    const dbName = this.getDbName()
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.activeDbName = null
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const sessionDB = new SessionDB()
export const STORE_NAMES = {
  BALANCE_TRANSACTIONS: 'balanceTransactions',
  SESSION_META: 'sessionMeta',
} as const
