import React, { useState } from 'react'
import { ORDER_QUICK_PRODUCTS } from '../constants/orderQuickProducts.js'
import { quickProductBtnClassName } from '../utils/orderQuickProductColors.js'

/**
 * Griglia pulsanti prodotto con scelta varianti (condivisa ordini / magazzino).
 */
export default function QuickProductPicker({ disabled = false, onSelect, className = '' }) {
  const [productChoice, setProductChoice] = useState(null)

  function handleQuickProductClick(item) {
    if (disabled) return
    if (item.variants?.length) {
      setProductChoice({ title: item.label, options: item.variants })
      return
    }
    onSelect?.(item.label)
  }

  function pickProductVariant(option) {
    setProductChoice(null)
    onSelect?.(option)
  }

  return (
    <>
      <div className={`order-product-grid${className ? ` ${className}` : ''}`} role="group" aria-label="Prodotti rapidi">
        {ORDER_QUICK_PRODUCTS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={quickProductBtnClassName(item.label, { choice: Boolean(item.variants?.length) })}
            disabled={disabled}
            onClick={() => handleQuickProductClick(item)}
            title={
              item.variants?.length
                ? `Scegli tipo di ${item.label.toLowerCase()}`
                : `Seleziona ${item.label}`
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {productChoice ? (
        <div className="staff-report-modal-backdrop" role="presentation" onClick={() => setProductChoice(null)}>
          <div
            className="card staff-report-modal order-product-choice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-product-choice-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="quick-product-choice-title" className="page-subheader" style={{ marginTop: 0 }}>
              Scegli {productChoice.title.toLowerCase()}
            </h3>
            <div className="order-product-choice-grid" role="group" aria-label={`Varianti ${productChoice.title}`}>
              {productChoice.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={quickProductBtnClassName(productChoice.title, { extra: 'order-product-choice-option' })}
                  onClick={() => pickProductVariant(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setProductChoice(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
