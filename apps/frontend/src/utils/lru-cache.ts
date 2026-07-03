type LruNode<K, V> = {
  key: K
  value: V
  prev: LruNode<K, V> | null
  next: LruNode<K, V> | null
}

export class LruCache<K, V> {
  private readonly nodes = new Map<K, LruNode<K, V>>()
  private head: LruNode<K, V> | null = null
  private tail: LruNode<K, V> | null = null

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error('LruCache maxSize must be a positive integer')
    }
  }

  get size(): number {
    return this.nodes.size
  }

  has(key: K): boolean {
    return this.nodes.has(key)
  }

  get(key: K): V | undefined {
    const node = this.nodes.get(key)
    if (!node) return undefined

    this.moveToHead(node)
    return node.value
  }

  set(key: K, value: V): void {
    const existing = this.nodes.get(key)
    if (existing) {
      existing.value = value
      this.moveToHead(existing)
      return
    }

    const node: LruNode<K, V> = {
      key,
      value,
      prev: null,
      next: null,
    }

    this.nodes.set(key, node)
    this.insertAtHead(node)

    if (this.nodes.size > this.maxSize) {
      this.evictTail()
    }
  }

  clear(): void {
    this.nodes.clear()
    this.head = null
    this.tail = null
  }

  private insertAtHead(node: LruNode<K, V>): void {
    node.prev = null
    node.next = this.head

    if (this.head) {
      this.head.prev = node
    }

    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  private detach(node: LruNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    }

    if (this.head === node) {
      this.head = node.next
    }
    if (this.tail === node) {
      this.tail = node.prev
    }

    node.prev = null
    node.next = null
  }

  private moveToHead(node: LruNode<K, V>): void {
    if (this.head === node) return

    this.detach(node)
    this.insertAtHead(node)
  }

  private evictTail(): void {
    const tail = this.tail
    if (!tail) return

    this.detach(tail)
    this.nodes.delete(tail.key)
  }
}
