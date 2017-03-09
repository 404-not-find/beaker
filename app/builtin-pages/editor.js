import yo from 'yo-yo'
import mime from 'mime'
import {Archive, FileTree} from 'builtin-pages-lib'
import rFiles from './com/editor-files'

const models = {} // all in-memory models
var archive = null
var lastClickedFolder = false // used in 'new' interface

setup()
async function setup () {
  try {
    // load the archive
    var datHostname = window.location.pathname.split('/')[1]
    var datKey = await DatArchive.resolveName(datHostname)
    console.log('Loading', datKey)
    archive = new Archive(datKey)
    archive.dirtyFiles = {} // which files have been modified?
    archive.activeModel = null // what file are we viewing?
    archive.lastClickedNode = false // what path was last clicked?
    archive.fileTree = new FileTree(archive)
    await archive.setup('/')
    await archive.fileTree.setup()
    archive.addEventListener('changed', onArchiveChanged)
    renderNav()

    // debug
    window.models = models
    window.archive = archive
  } catch (e) {
    console.error('Failed to load', e)
  }
}

// rendering
// =

function renderNav () {
 // nav
  yo.update(
    document.querySelector('.editor-nav'),
    yo`
      <div class="editor-nav">
        <div class="header">
          <div class="project-title">${archive.info.title}</div>

          <div class="btn-bar">
            <button class="btn" title="New File" onclick=${newFileInterface}>
              <i class="fa fa-plus"></i>
            </button>

            <button class="btn" title="Save" onclick=${save}>
              <i class="fa fa-floppy-o"></i>
            </button>

            <button class="btn" title="Fork This Project" onclick=${onFork}>
              <i class="fa fa-code-fork"></i>
            </button>
          </div>
        </div>
        ${rFiles(archive)}
      </div>`
  )

  // editor header
  const activeModel = archive.activeModel
  const isChanged = (activeModel && archive.dirtyFiles[activeModel.path]) ? '*' : ''

  yo.update(
    document.querySelector('.editor-editor .header'),
    yo`
      <div class="header">
        <div id="new-file-popup"></div>
        <div class="file-info">
          ${activeModel ? rFileIcon(activeModel.path) : ''}
          ${activeModel ? activeModel.path : ''}${isChanged}
        ${!archive.info.isOwner 
          ? yo`<span>
            - Read only. <a onclick=${onFork}><i class="fa fa-code-fork"></i>Fork this site</a> to make changes.
          </span>` : ''}
        </div>
      </div>`
  )
}

function rFileIcon (path) {
  // lookup the mimetype
  var mimetype = mime.lookup(path)
  var cls = 'file-o'

  if (mimetype.startsWith('image/')) {
    cls = 'file-image-o'
  } else if (mimetype.startsWith('video/')) {
    cls = 'file-video-o'
  } else if (mimetype.startsWith('audio/')) {
    cls = 'file-audio-o'
  } else if (mimetype.startsWith('text/html') || mimetype.startsWith('application/')) {
    cls = 'file-code-o'
  } else if (mimetype.startsWith('text/')) {
    cls = 'file-text-o'
  }

  return yo`<i class="fa fa-${cls}"></i>`
}

// event handlers
// =

window.addEventListener('editor-created', () => {
  // set editor to read-only if not the owner
  if (!archive.info.isOwner) {
    editor.updateOptions({readOnly: true})
  }

  // try to set active
  setActive('index.html')
})

window.addEventListener('open-file', e => {
  setActive(e.detail.path)
  archive.lastClickedNode = e.detail.path
  lastClickedFolder = e.detail.path.split('/').slice(0, -1).join('/')
})

window.addEventListener('open-folder', e => {
  archive.lastClickedNode = e.detail.path
  lastClickedFolder = e.detail.path
  renderNav()
})

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.keyCode === 83/*'S'*/) {
    e.preventDefault()
    save()
  }
})

async function onFork () {
  var newArchive = await DatArchive.fork(archive.url)
  window.location = 'beaker:editor/' + newArchive.url.slice('dat://'.length)
}

function onDidChangeContent (path) {
  return e => {
    if (archive.dirtyFiles[path]) {
      return
    }

    // update state and render
    archive.dirtyFiles[path] = true
    renderNav()
  }
}

async function onArchiveChanged () {
  await archive.fileTree.setup()
  renderNav()
}

function onSubmitNewFile (e) {
  e.preventDefault()
  var path = normalizePath(e.target.name.value)
  archive.lastClickedNode = null // clear so that our new file gets highlighted
  generate(path)
  setActive(path)
}

// internal methods
// =

function generate (path) {
  // setup the model  
  path = normalizePath(path)
  const url = archive.url + '/' + path
  models[path] = monaco.editor.createModel('', null, monaco.Uri.parse(url))
  models[path].path = path
  models[path].isEditable = true
  models[path].lang = models[path].getModeId()
  models[path].onDidChangeContent(onDidChangeContent(path))
  archive.dirtyFiles[path] = true
}

async function load (path) {
  // load the file content
  path = normalizePath(path)
  const url = archive.url + '/' + path
  const str = await archive.readFile(path, 'utf8')

  // setup the model
  models[path] = monaco.editor.createModel(str, null, monaco.Uri.parse(url))
  models[path].path = path
  models[path].isEditable = true
  models[path].lang = models[path].getModeId()
  models[path].onDidChangeContent(onDidChangeContent(path))
}

async function save () {
  const activeModel = archive.activeModel
  if (!activeModel || !archive.dirtyFiles[activeModel.path]) {
    return
  }

  // write the file content
  await archive.writeFile(activeModel.path, activeModel.getValue(), 'utf-8')

  // update state and render
  archive.dirtyFiles[activeModel.path] = false
  renderNav()
}

async function setActive (path) {
  if (path === false) {
    archive.activeModel = null
    renderNav()
    return
  }

  path = normalizePath(path)

  // load according to editability
  const isEditable = checkIfIsEditable(path)
  if (isEditable) {
    await setEditableActive(path)
  } else {
    await setUneditableActive(path)
  }

  // set active
  archive.activeModel = models[path]
  renderNav()
}

function normalizePath (path) {
  if (path.startsWith('/')) return path.slice(1)
  return path
}

function checkIfIsEditable (path) {
  // no extension?
  if (path.split('/').pop().indexOf('.') === -1) {
    return true // assume plaintext
  }
  // do we have this language?
  const l = monaco.languages.getLanguages()
  for (var i=0; i < l.length; i++) {
    for (var j=0; j < l[i].extensions.length; j++) {
      if (path.endsWith(l[i].extensions[j])) {
        return true
      }
    }
  }
  // lookup the mimetype
  var mimetype = mime.lookup(path)
  // text or application?
  if (mimetype.startsWith('text/') || mimetype.startsWith('application/')) {
    return true
  }
  // svg?
  if (mimetype === 'image/svg+xml') {
    return true
  }
  return false
}

function newFileInterface () {
  // initial value
  var value = ''
  if (lastClickedFolder) {
    value = lastClickedFolder + '/'
  }

  // render interface
  yo.update(document.getElementById('new-file-popup'), 
    yo`<div id="new-file-popup">
      <form class="new-file-form" onsubmit=${onSubmitNewFile}>
        <label>
          Name<br>
          <input type="text" name="name" />
        </label>
        <button class="btn" type="submit">Create</button>
      </form>
    </div>`
  )
  var input = document.querySelector('#new-file-popup input')
  input.value = value
  input.focus()
}

async function setEditableActive (path) {
  // load if not yet loaded
  if (!(path in models)) {
    await load(path)
  }
  editor.setModel(models[path])
  document.getElementById('uneditable-container').classList.add('hidden')
  document.getElementById('editable-container').classList.remove('hidden')
}

async function setUneditableActive (path) {
  // lookup the mimetype
  var mimetype = mime.lookup(path)

  // set the entry info
  models[path] = {path, isEditable: false, lang: ''}
  document.getElementById('editable-container').classList.add('hidden')
  if (mimetype.startsWith('image/')) {
    yo.update(document.getElementById('uneditable-container'), yo`
      <div id="uneditable-container">
        <img src=${archive.url + '/' + path} />
      </div>
    `)
  } else if (mimetype.startsWith('video/')) {
    yo.update(document.getElementById('uneditable-container'), yo`
      <div id="uneditable-container">
        <video controls width="400" src=${archive.url + '/' + path}></video>
      </div>
    `)
  } else if (mimetype.startsWith('audio/')) {
    yo.update(document.getElementById('uneditable-container'), yo`
      <div id="uneditable-container">
        <audio controls width="400" src=${archive.url + '/' + path}></audio>
      </div>
    `)
  } else {
    yo.update(document.getElementById('uneditable-container'), yo`
      <div id="uneditable-container">
        Unsupported filetype, ${mimetype}
      </div>
    `)
  }
}