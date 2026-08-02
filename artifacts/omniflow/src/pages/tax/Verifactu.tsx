import { useState } from 'react'

interface Verifactu {
  id: string
  numero: string
  hash: string
  hashAnterior: string
  qr: string
  fecha: string
}

export default function Verifactu() {
  const [facturas] = useState<Verifactu[]>([])

  const generarHash = async (datos: string, anterior: string) => {
    const msg = `${datos}${anterior}${new Date().toISOString()}`
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase()
  }

  const generarQRUrl = (nif: string, num: string, importe: number, hash: string) => {
    return `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${nif}&num=${num}&importe=${importe}&hash=${hash}`
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Verifactu - RD 1007/2023</h1>
      <div className="bg-yellow-50 border border-yellow-300 p-4 rounded mb-6">
        <p className="font-bold">⚠️ Obligatorio desde 1 julio 2026 - Multa 50.000€</p>
        <p>Hash encadenado + QR + No borrable</p>
      </div>
      <p>Facturas Verifactu: {facturas.length}</p>
      <p className="text-sm text-gray-500 mt-4">Siguiente paso: Conectar con accounting/InvoicesList.tsx</p>
    </div>
  )
}