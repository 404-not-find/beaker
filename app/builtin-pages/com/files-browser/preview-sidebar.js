import * as yo from 'yo-yo'
import renderFileOIcon from '../../icon/file-o'
import {niceDate} from '../../../lib/time'
import prettyBytes from 'pretty-bytes'
import rIcon from './node-icon'
import renderFilePreview from '../file-preview'

// events
// =

async function onImportFiles (filesBrowser) {
  const node = Array.from(filesBrowser.selectedNodes.values())[0]
  const url = node ? node.url : window.location.pathname.slice(1)
  let files = await beaker.browser.showOpenDialog({
    title: 'Import files to this archive',
    buttonLabel: 'Import',
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  if (files) {
    await Promise.all(files.map(src => DatArchive.importFromFilesystem({
      src,
      dst: url,
      ignore: ['dat.json'],
      inplaceImport: false
    })))
    await filesBrowser.reloadTree()
    filesBrowser.rerender()
  }
}

// exported api
// =

export default function render (filesBrowser) {
  var node = Array.from(filesBrowser.selectedNodes.values())[0]
  if (!node) node = filesBrowser.getCurrentSource()

  const isArchive = node && node.constructor.name === 'FSArchive'
  const archiveInfo = node && node._archiveInfo
  const networked = archiveInfo && archiveInfo.userSettings.networked

  if (!archiveInfo) return ''

  // render preview
  let preview
  if (node.type === 'file') {
    preview = renderFilePreview(node)
    if (!preview) {
      preview = yo`<div class="icon-wrapper"><i class="fa fa-file-text-o"></i></div>`
    }
  }

  return yo`
    <div class="preview-sidebar">
      <div class="archive-info">
        <div class="header">
          <h1>
            <a href=${archiveInfo.url}>
              ${archiveInfo.title || 'Untitled'}
            </a>
          </h1>

          <div class="actions">
            <div class="btn-group">
              <button class="btn" onclick=${e => onImportFiles(filesBrowser)}>
                Import files
                <i class="fa fa-plus"></i>
              </button>

              <button class="btn">
                <i class="fa fa-ellipsis-v"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="main">
          <p class="desc">${archiveInfo.description || yo`<em>No description</em>`}</p>
        </div>
      </div>
      ${preview ? yo`
        <div class="preview">
          ${preview}
        </div>
      ` : ''}
      <div class="metadata">
        ${!isArchive ? yo`<div class="name">${node.name}</div>` : ''}
        <table>
          ${node.size ? yo`<tr><td class="label">Size</td><td>${prettyBytes(node.size)}</td></tr>` : ''}
          ${node.mtime ? yo`<tr><td class="label">Updated</td><td>${niceDate(+(node.mtime || 0))}</td></tr>` : ''}
          <tr><td class="label">Editable</td><td>${node.isEditable ? 'Yes' : 'No'}</td></tr>
        </table>
      </div>
    </div>
  `
}