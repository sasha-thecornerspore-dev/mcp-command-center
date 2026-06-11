// Screenshot generator. Runs as its own Electron entry:  electron scripts/capture.cjs
// Loads the BUILT renderer WITHOUT the preload bridge, so window.mcc is undefined and
// the in-app mock data (src/renderer/src/mockApi.ts) drives a populated UI. Then it
// clicks through the tabs and saves a real capturePage() PNG of each to docs/screenshots.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
const INDEX = path.join(__dirname, '..', 'out', 'renderer', 'index.html')
const TABS = [
  ['Dashboard', 'dashboard'],
  ['Connection Matrix', 'matrix'],
  ['Catalog', 'catalog'],
  ['AI Assistant', 'assistant'],
  ['Profiles', 'profiles']
]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    show: false,
    backgroundColor: '#0b0e14',
    webPreferences: { sandbox: false } // no preload -> mock API path
  })
  await win.loadFile(INDEX)
  await wait(1200)

  for (const [label, file] of TABS) {
    await win.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(
        label
      )})); if (b) b.click(); return !!b })()`
    )
    await wait(700)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${file}.png`), img.toPNG())
    console.log('captured', file)
  }
  app.quit()
}

app.whenReady().then(run)
app.on('window-all-closed', () => app.quit())
