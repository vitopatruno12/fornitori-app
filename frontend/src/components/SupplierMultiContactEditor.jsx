import React from 'react'
import { SUPPLIER_MERCHANDISE_CATEGORY_OPTIONS, emptyContactItem } from '../utils/supplierContactLists.js'

function ContactListEditor({ title, hint, items, onItemsChange, setItems, inputType = 'text', placeholder, addLabel }) {
  const changeItems = onItemsChange || setItems

  function applyItemsChange(updater) {
    if (typeof changeItems !== 'function') return
    changeItems((prevState) => {
      const base = Array.isArray(prevState) ? prevState : []
      return updater(base)
    })
  }

  function updateItem(index, patch) {
    applyItemsChange((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function addItem() {
    applyItemsChange((prev) => [...(Array.isArray(prev) ? prev : []), emptyContactItem()])
  }

  function removeItem(index) {
    applyItemsChange((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const next = list.filter((_, i) => i !== index)
      return next.length ? next : [emptyContactItem()]
    })
  }

  const list = Array.isArray(items) && items.length ? items : [emptyContactItem()]

  return (
    <div className="supplier-contact-list">
      <div className="supplier-contact-list-head">
        <label className="supplier-contact-list-title">{title}</label>
        {hint ? <p className="supplier-contact-list-hint">{hint}</p> : null}
      </div>
      {list.map((item, index) => (
        <div key={`${title}-${index}`} className="supplier-contact-row">
          <label className="supplier-contact-enable" title="Contatto attivo (usato per ordini e comunicazioni)">
            <input
              type="checkbox"
              checked={item.enabled !== false}
              onChange={(e) => updateItem(index, { enabled: e.target.checked })}
            />
            <span className="supplier-contact-enable-label">Attivo</span>
          </label>
          <input
            type={inputType}
            className="form-control"
            value={item.value || ''}
            onChange={(e) => updateItem(index, { value: e.target.value })}
            placeholder={placeholder}
          />
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeItem(index)}>
            Rimuovi
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>
        {addLabel}
      </button>
    </div>
  )
}

export default function SupplierMultiContactEditor({
  phones,
  setPhones,
  emails,
  setEmails,
  cities,
  setCities,
  merchandiseCategories,
  setMerchandiseCategories,
}) {
  function toggleCategory(label) {
    setMerchandiseCategories((prev) => {
      const list = Array.isArray(prev) ? prev : []
      return list.includes(label) ? list.filter((item) => item !== label) : [...list, label]
    })
  }

  const selected = Array.isArray(merchandiseCategories) ? merchandiseCategories : []

  return (
    <div className="supplier-multi-contact-editor">
      <div className="supplier-form-panel supplier-contacts-panel">
        <div className="supplier-form-panel-head">
          <h3 className="supplier-form-panel-title">Contatti e sedi</h3>
          <p className="supplier-form-panel-lead">Telefoni, email e città usati per ordini e comunicazioni.</p>
        </div>
        <div className="supplier-contacts-grid">
          <ContactListEditor
            title="Telefoni"
            hint="Il primo attivo è il principale."
            items={phones}
            setItems={setPhones}
            inputType="tel"
            placeholder="080 1234567 o 3331234567"
            addLabel="+ Aggiungi telefono"
          />
          <ContactListEditor
            title="Email"
            hint="La prima attiva è usata per gli ordini."
            items={emails}
            setItems={setEmails}
            inputType="email"
            placeholder="info@fornitore.it"
            addLabel="+ Aggiungi email"
          />
          <ContactListEditor
            title="Città"
            hint="Più sedi o punti di ritiro/consegna."
            items={cities}
            setItems={setCities}
            placeholder="Lecce"
            addLabel="+ Aggiungi città"
          />
        </div>
      </div>

      <div className="supplier-form-panel supplier-category-panel">
        <div className="supplier-form-panel-head">
          <h3 className="supplier-form-panel-title">Categorie merceologiche</h3>
          <p className="supplier-form-panel-lead">
            Tocca le categorie fornite: filtrano i pulsanti rapidi negli ordini.
          </p>
        </div>
        <div className="supplier-category-chips" role="group" aria-label="Categorie merceologiche">
          {SUPPLIER_MERCHANDISE_CATEGORY_OPTIONS.map((label) => {
            const active = selected.includes(label)
            return (
              <button
                key={label}
                type="button"
                className={active ? 'supplier-category-chip is-active' : 'supplier-category-chip'}
                aria-pressed={active}
                onClick={() => toggleCategory(label)}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="supplier-category-selected">
          {selected.length ? (
            <>
              <span className="supplier-category-selected-label">{selected.length} selezionate</span>
              <span className="supplier-category-selected-list">{selected.join(' · ')}</span>
            </>
          ) : (
            <span className="supplier-category-selected-empty">Nessuna categoria selezionata</span>
          )}
        </div>
      </div>
    </div>
  )
}
