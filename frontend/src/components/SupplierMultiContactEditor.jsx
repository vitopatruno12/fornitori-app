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
    <div className="supplier-contact-list" style={{ marginBottom: '0.85rem' }}>
      <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>{title}</label>
      {hint ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0, marginBottom: '0.45rem' }}>{hint}</p>
      ) : null}
      {list.map((item, index) => (
        <div
          key={`${title}-${index}`}
          className="form-row"
          style={{ alignItems: 'center', flexWrap: 'nowrap', gap: '0.45rem', marginBottom: '0.35rem' }}
        >
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0, flex: '0 0 auto', cursor: 'pointer' }}
            title="Contatto attivo (usato per ordini e comunicazioni)"
          >
            <input
              type="checkbox"
              checked={item.enabled !== false}
              onChange={(e) => updateItem(index, { enabled: e.target.checked })}
            />
          </label>
          <input
            type={inputType}
            className="form-control"
            style={{ flex: '1 1 auto', minWidth: 0 }}
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
      <ContactListEditor
        title="Telefoni"
        hint="Spunta i numeri attivi e aggiungine quanti ne servono. Il primo attivo è il principale."
        items={phones}
        setItems={setPhones}
        inputType="tel"
        placeholder="080 1234567 o 3331234567"
        addLabel="+ Aggiungi telefono"
      />
      <ContactListEditor
        title="Email"
        hint="Spunta le email attive. La prima attiva è usata per gli ordini."
        items={emails}
        setItems={setEmails}
        inputType="email"
        placeholder="info@fornitore.it"
        addLabel="+ Aggiungi email"
      />
      <ContactListEditor
        title="Città"
        hint="Puoi indicare più sedi o città di ritiro/consegna."
        items={cities}
        setItems={setCities}
        placeholder="Lecce"
        addLabel="+ Aggiungi città"
      />
      <div className="supplier-category-list" style={{ marginBottom: '0.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
          Categorie merceologiche fornite
        </label>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0, marginBottom: '0.55rem' }}>
          Seleziona una o più categorie: filtrano i pulsanti rapidi negli ordini verso questo fornitore.
        </p>
        <div
          className="supplier-category-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.35rem 0.75rem',
            maxHeight: 220,
            overflow: 'auto',
            padding: '0.55rem',
            border: '1px solid var(--border-subtle, rgba(0,0,0,0.1))',
            borderRadius: 8,
            background: 'var(--surface-2, rgba(0,0,0,0.03))',
          }}
        >
          {SUPPLIER_MERCHANDISE_CATEGORY_OPTIONS.map((label) => (
            <label
              key={label}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', margin: 0, cursor: 'pointer', fontSize: '0.88rem' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(label)}
                onChange={() => toggleCategory(label)}
                style={{ marginTop: '0.15rem' }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {selected.length ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.45rem', marginBottom: 0 }}>
            Selezionate: {selected.join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
