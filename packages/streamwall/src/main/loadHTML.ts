import { WebContents } from 'electron'
import path from 'path'
import querystring from 'querystring'

export function loadHTML(
  webContents: WebContents,
  name: 'background' | 'overlay' | 'playHLS' | 'control',
  options?: { query?: Record<string, string> },
) {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const queryString = options?.query
      ? '?' + querystring.stringify(options.query)
      : ''
    webContents.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/src/renderer/${name}.html` +
        queryString,
    )
  } else {
    webContents.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/src/renderer/${name}.html`,
      ),
      options,
    )
  }
}
