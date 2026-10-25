import React, { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Lista a finestra fissa (senza dipendenze): rende solo gli item visibili + overscan.
 * Ideale per tablet Android con centinaia di schede/righe.
 */
export default function VirtualList({
  items = [],
  estimateItemHeight = 168,
  overscan = 4,
  className = '',
  style,
  getItemKey,
  renderItem,
  emptyMessage = 'Nessun elemento.',
}) {
  const scrollerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const setScrollerNode = useCallback((node) => {
    scrollerRef.current = node
    if (!node) return
    setViewportH(node.clientHeight || 480)
  }, [])

  React.useEffect(() => {
    const node = scrollerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      setViewportH(node.clientHeight || 480)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [items.length])

  const total = items.length
  const rowH = Math.max(48, Number(estimateItemHeight) || 168)
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan)
  const visibleCount = Math.ceil(viewportH / rowH) + overscan * 2
  const end = Math.min(total, start + visibleCount)
  const padTop = start * rowH
  const padBottom = Math.max(0, (total - end) * rowH)

  const slice = useMemo(() => items.slice(start, end), [items, start, end])

  if (!total) {
    return (
      <div className={className} style={style}>
        <p className="fatture-note" style={{ margin: '0 1rem 1rem' }}>
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={setScrollerNode}
      className={`virtual-list ${className}`.trim()}
      style={{
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        maxHeight: 'min(72vh, 780px)',
        ...style,
      }}
      onScroll={onScroll}
    >
      <div style={{ height: padTop }} aria-hidden />
      {slice.map((item, i) => {
        const index = start + i
        const key =
          typeof getItemKey === 'function' ? getItemKey(item, index) : item?.id ?? index
        return (
          <div key={key} className="virtual-list-item" style={{ minHeight: rowH }}>
            {renderItem(item, index)}
          </div>
        )
      })}
      <div style={{ height: padBottom }} aria-hidden />
    </div>
  )
}
