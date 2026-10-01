import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualListProps<T> {
  items: T[];
  estimateSize: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  maxHeight?: number;
  overscan?: number;
  className?: string;
  testId?: string;
}

/**
 * Lightweight virtualized list (P0.4) built on @tanstack/react-virtual.
 * Only the rows intersecting the viewport (plus overscan) are in the DOM.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  getKey,
  renderItem,
  maxHeight = 520,
  overscan = 8,
  className,
  testId = 'virtual-list',
}: VirtualListProps<T>): React.ReactElement {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={`virtual-list ${className ?? ''}`}
      style={{ maxHeight, overflowY: 'auto' }}
      data-testid={testId}
    >
      <div className="virtual-list-inner" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <div
              key={getKey(item, virtualItem.index)}
              className="virtual-list-row"
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
