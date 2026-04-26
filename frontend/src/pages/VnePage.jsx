import React from 'react'
import VneSection from '../components/VneSection'

export default function VnePage() {
  return (
    <>
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">VNE Cassa Automatica</h1>
        <p className="staff-page-lead">Monitoraggio stato, operazioni, contabilita e chiusure dei modelli VNE.</p>
      </section>
      <VneSection embedded />
    </>
  )
}
