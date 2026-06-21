import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendRoot = join(__dirname, '..')
const srcRoot = join(frontendRoot, 'src')

/** Stili globali: contano per ogni ambito satellitare. */
const SHARED_SCOPE_FILES = ['style.css']

/** File sorgente per ambito aggiornamento (hash combinato per scope). */
const SCOPE_FILES = {
  full: ['**'],
  station: [
    'OperatorStationApp.tsx',
    'components/OperatorSatelliteShell.tsx',
    'pages/HomePage.jsx',
    'pages/StaffPage.jsx',
    'pages/NewOrderPage.jsx',
    'pages/PrimaNotaPage.jsx',
    'components/PrimaNotaLocalePicker.jsx',
    'utils/operatorMode.ts',
    'utils/primaNotaLocaleAccess.js',
    'utils/primaNotaStaffLocaleLink.js',
    'utils/staffLocaleAccessCode.js',
    'pwa/PwaUpdateContext.jsx',
    'utils/pwaUpdateScope.ts',
  ],
  order: ['OperatorOrderApp.tsx', 'pages/NewOrderPage.jsx', 'components/OperatorSatelliteShell.tsx'],
  delivery: ['OperatorDeliveryApp.tsx', 'pages/DeliveryPage.jsx', 'components/OperatorSatelliteShell.tsx'],
  'prima-nota': [
    'OperatorPrimaNotaApp.tsx',
    'pages/PrimaNotaPage.jsx',
    'components/PrimaNotaLocalePicker.jsx',
    'components/OperatorSatelliteShell.tsx',
    'utils/primaNotaLocaleAccess.js',
    'utils/primaNotaStaffLocaleLink.js',
  ],
}

function walkDir(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walkDir(full, files)
    } else {
      files.push(full)
    }
  }
  return files
}

function hashFiles(relPaths) {
  const hash = createHash('sha256')
  const allFiles = walkDir(srcRoot).map((f) => relative(srcRoot, f).replace(/\\/g, '/'))
  const selected =
    relPaths.includes('**')
      ? allFiles.sort()
      : [...new Set([...SHARED_SCOPE_FILES, ...relPaths.map((p) => p.replace(/\\/g, '/'))])]
          .filter((p) => p === 'style.css' || allFiles.includes(p))
          .sort()
  for (const rel of selected) {
    const content = readFileSync(join(srcRoot, rel))
    hash.update(rel)
    hash.update('\0')
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 16)
}

const versions = {
  build: hashFiles(['**']),
  generatedAt: new Date().toISOString(),
  scopes: Object.fromEntries(
    Object.entries(SCOPE_FILES).map(([scope, files]) => [scope, hashFiles(files)]),
  ),
}

const outPath = join(frontendRoot, 'public', 'section-versions.json')
writeFileSync(outPath, `${JSON.stringify(versions, null, 2)}\n`, 'utf8')
console.log('section-versions.json build=', versions.build, versions.scopes)
