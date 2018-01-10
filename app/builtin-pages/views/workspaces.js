/* globals beaker */

import yo from 'yo-yo'
import {pluralize} from '../../lib/strings'
import {pushUrl, writeToClipboard} from '../../lib/fg/event-handlers'
import toggleable from '../com/toggleable'
import renderDiff from '../com/diff'
import renderGearIcon from '../icon/gear-small'
import * as toast from '../com/toast'

// main
// =
let allWorkspaces = []
let currentWorkspaceName
let tmpWorkspaceName
let workspaceInfo
let diff
let diffAdditions = 0
let diffDeletions = 0
let currentDiffNode
let numCheckedRevisions
let activeView = 'revisions'

// HACK FIX
// the good folk of whatwg didnt think to include an event for pushState(), so let's add one
// -prf
var _wr = function (type) {
  var orig = window.history[type]
  return function () {
    var rv = orig.apply(this, arguments)
    var e = new Event(type.toLowerCase())
    e.arguments = arguments
    window.dispatchEvent(e)
    return rv
  }
}
window.history.pushState = _wr('pushState')
window.history.replaceState = _wr('replaceState')

setup()
async function setup () {
  allWorkspaces = await beaker.workspaces.list(0)
  await loadCurrentWorkspace()

  window.addEventListener('pushstate', loadCurrentWorkspace)
  window.addEventListener('popstate', loadCurrentWorkspace)

  render()
}

async function loadCurrentWorkspace () {
  currentWorkspaceName = parseURLWorkspaceName()
  tmpWorkspaceName = currentWorkspaceName
  if (currentWorkspaceName) {
    workspaceInfo = await beaker.workspaces.get(0, currentWorkspaceName)
    if (workspaceInfo && workspaceInfo.localFilesPath) {
      workspaceInfo.revisions = await beaker.workspaces.listChangedFiles(0, currentWorkspaceName, {shallow: true, compareContent: true})
    } else {
      workspaceInfo.revisions = []
    }
  } else {
    workspaceInfo = null
  }

  render()
}

async function loadCurrentDiff (revision) {
  if (!revision) {
    diff = ''
    currentDiffNode = null
    diffAdditions = 0
    diffDeletions = 0
    return
  }

  // fetch the diff
  try {
    diff = await beaker.workspaces.diff(0, currentWorkspaceName, revision.path)

    diffDeletions = diff.reduce((sum, el) => {
      if (el.removed) return sum + el.count
      return sum
    }, 0)

    diffAdditions = diff.reduce((sum, el) => {
      if (el.added) return sum + el.count
      return sum
    }, 0)
  } catch (e) {
    if (e.invalidEncoding) {
      diff = {invalidEncoding: true}
    }
  }
}

function parseURLWorkspaceName () {
  return window.location.pathname.replace(/\//g, '')
}

// events
// =

function onCopy (str, successMessage = 'Copied to clipboard') {
  writeToClipboard(str)
  toast.create(successMessage)
}

async function onCreateWorkspace (type) {
  // create a new workspace
  const wsInfo = await beaker.workspaces.create(0) // TODO: type
  allWorkspaces = await beaker.workspaces.list(0)

  if (workspaceInfo) {
    // add a loading indicator if creating from an existing workspace
    // NOTE: No perceptible "loading" actually happens here. I added the loading indicator
    // because otherwise it's difficult to notice that a new project was created
    // -tbv
    activeView = ''
    render()

    setTimeout(() => {
      activeView = 'revisions'
      history.pushState({}, null, `beaker://workspaces/${wsInfo.name}`)
    }, 500)
  } else {
    activeView = 'revisions'
    history.pushState({}, null, `beaker://workspaces/${wsInfo.name}`)
  }
}

async function onDeleteWorkspace (name) {
  if (!confirm(`Delete workspace://${name}?`)) {
    return
  }

  await beaker.workspaces.remove(0, name)
  allWorkspaces = await beaker.workspaces.list(0)
  currentWorkspaceName = ''

  // if deleting from the workspace view, go back to beaker://workspaces
  if (workspaceInfo) {
    history.pushState({}, null, 'beaker://workspaces/')
    workspaceInfo = null
  }
  render()
}

async function onPublishChanges () {
  let changes = workspaceInfo.revisions
  if (numCheckedRevisions) {
    changes = changes.filter(rev => !!rev.checked)
  }
  const paths = changes.map(rev => rev.path)

  if (!confirm(`Publish ${paths.length} ${pluralize(paths.length, 'change')}?`)) return
  await beaker.workspaces.publish(0, currentWorkspaceName, {paths})
  await loadCurrentDiff(null)
  numCheckedRevisions = 0
  loadCurrentWorkspace()
}

async function onRevertChanges () {
  let changes = workspaceInfo.revisions
  if (numCheckedRevisions) {
    changes = changes.filter(rev => !!rev.checked)
  }
  const paths = changes.map(rev => rev.path)

  if (!confirm(`Revert ${paths.length} ${pluralize(paths.length, 'change')}?`)) return
  await beaker.workspaces.revert(0, currentWorkspaceName, {paths})
  await loadCurrentDiff(null)
  numCheckedRevisions = 0
  loadCurrentWorkspace()
}

function onOpenFolder (path) {
  beaker.workspaces.openFolder(path)
}

function onChangeView (view) {
  activeView = view
  render()
}

function onChangeWorkspaceName (e) {
  tmpWorkspaceName = e.target.value
}

async function onSaveWorkspaceName () {
  // bail if the workspace name wasn't updated
  if (workspaceInfo.name === tmpWorkspaceName) return

  // check if there's an existing workspace
  const existingWorkspace = await beaker.workspaces.get(0, tmpWorkspaceName)
  if (existingWorkspace && !confirm(`There's an existing workspace at workspace://${tmpWorkspaceName}. Do you want to continue?`)) {
    return
  }

  await beaker.workspaces.set(0, workspaceInfo.name, {name: tmpWorkspaceName})
  toast.create(`Workspace name updated to ${tmpWorkspaceName}`)
  history.pushState({}, null, `beaker://workspaces/${tmpWorkspaceName}`)
}

async function onChangeWorkspaceDirectory (e) {
  const directory = await beaker.browser.showOpenDialog({
    title: 'Select a folder',
    buttonLabel: 'Select folder',
    properties: ['openDirectory']
  })

  if (directory) {
    const path = directory[0]
    workspaceInfo.localFilesPath = path
    await beaker.workspaces.set(0, workspaceInfo.name, {localFilesPath: path})
    toast.create(`Workspace directory updated to ${path}`)
    render()
  }

  await loadCurrentDiff()
  render()
}

function onToggleChangedNodeChecked (e, node) {
  e.stopPropagation()
  node.checked = !node.checked
  numCheckedRevisions = workspaceInfo.revisions.filter(r => !!r.checked).length
  render()
}

async function onClickChangedNode (node) {
  currentDiffNode = node
  await loadCurrentDiff(node)
  render()
}

// rendering
// =

function render () {
  if (currentWorkspaceName.length && !workspaceInfo) {
    render404()
  } else if (!workspaceInfo) {
    renderWorkspacesListing()
    document.querySelector('.window-content').classList.remove('workspace')
  } else {
    renderWorkspace()
    document.querySelector('.window-content').classList.add('workspace')
  }
}

function renderWorkspacesListing () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="builtin-wrapper workspaces-wrapper listing">
      <div>
        <div class="builtin-sidebar">
          <h1>Workspaces</h1>
        </div>

        <div class="builtin-main">
          <div class="builtin-header fixed">
            ${toggleable(yo`
            <div class="dropdown toggleable-container">
              <button class="btn toggleable">
                New
                <i class="fa fa-plus"></i>
              </button>

              <div class="dropdown-items left">
                <div class="dropdown-item" onclick=${onCreateWorkspace}>
                  <div class="label">
                    <i class="fa fa-code"></i>
                    Website
                  </div>

                  <p class="description">
                    Build a peer-to-peer website
                  </p>
                </div>

                <div class="dropdown-item" onclick=${() => onCreateWorkspace('app')}>
                  <div class="label">
                    <i class="fa fa-cube"></i>
                    App
                  </div>

                  <p class="description">
                    Build a peer-to-peer application
                  </p>
                </div>
              </div>
            </div>
          `)}
          </div>

          <div class="workspaces">
            ${allWorkspaces.map(renderWorkspaceListItem)}
          </div>
        </div>
      </div>
    </div>
  `)
}

function renderWorkspaceListItem (workspace) {
  return yo`
    <a class="row thick workspace" href="beaker://workspaces/${workspace.name}" onclick=${pushUrl}>
      <div>
        <img class="favicon" src="beaker-favicon:workspace://${workspace.name}"/>

        <span class="info">
          <div>
            <span class="title">workspace://${workspace.name}</span>
          </div>

          <div class="metadata">
            <span class="path" onclick=${e => {e.stopPropagation(); e.preventDefault(); onOpenFolder(workspace.localFilesPath);}}>
              ${workspace.localFilesPath}
            </span>
          </div>
        </span>
      </div>

      <div class="buttons">
        <button class="btn transparent remove-workspace" title="Delete this workspace" onclick=${e => {e.preventDefault(); e.stopPropagation(); onDeleteWorkspace(workspace.name);}}>
          <i class="fa fa-trash-o"></i>
        </button>

        ${workspace.localFilesPath ? yo`
          <a target="_blank" title="Preview changes" onclick=${e => {e.stopPropagation()}} href="workspace://${workspace.name}" class="btn">
            <span>Live preview</span>
            <i class="fa fa-external-link"></i>
          </a>
        ` : ''}
      </div>
    </a>
  `
}

function renderWorkspace () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="workspaces-wrapper builtin-wrapper workspace">
      ${renderHeader()}
      ${renderView()}
    </div>
  `)
}

function render404 () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="workspaces-wrapper not-found">
      <span class="name">workspace://${currentWorkspaceName}</span> does not exist

      <div class="links">
        <span onclick=${() => history.pushState({}, null, 'beaker://workspaces')}>
          « Back to all workspaces
        </span>
      </div>
    </div>
  `)
}

function renderHeader () {
  return yo`
    <div class="header">
      <div class="top">
        <div class="dropdown">
          ${toggleable(yo`
            <div class="dropdown toggleable-container">
              <div class="menu-toggle-btn toggleable">
                <img class="favicon" src="beaker-favicon:workspace://${workspaceInfo.name}"/>
                <span class="name">workspace://${workspaceInfo.name}</span>
                <i class="fa fa-chevron-down"></i>
              </div>

              <div class="menu dropdown-items with-triangle left">
                <div class="menu-header">
                  <img class="favicon" src="beaker-favicon:workspace://${workspaceInfo.name}"/>

                  <input type="text" class="inline name" value=${tmpWorkspaceName} onkeyup=${onChangeWorkspaceName} onblur=${onSaveWorkspaceName}/>
                </div>

                <div class="menu-links">
                  <div class="link-container">
                    <i class="fa fa-eye"></i>

                    <a class="url" href="workspace://${workspaceInfo.name}">
                      workspace://${workspaceInfo.name}
                    </a>

                    <button class="btn copy-btn outline tooltip-container" data-tooltip="Local preview URL" onclick=${() => onCopy(`workspace://${workspaceInfo.name}`, 'URL copied to clipboard')}>
                      Copy
                    </button>
                  </div>

                  <div class="link-container">
                    <i class="fa fa-link"></i>

                    <a class="url" href=${workspaceInfo.publishTargetUrl}>
                      ${workspaceInfo.publishTargetUrl}
                    </a>

                    <button class="btn copy-btn tooltip-container" data-tooltip="Live URL" onclick=${() => onCopy(workspaceInfo.publishTargetUrl, 'URL copied to clipboard')}>
                      Copy
                    </button>
                  </div>

                  <div class="link-container">
                    <i class="fa fa-folder-o"></i>

                    <span class="url" onclick=${() => onOpenFolder(workspaceInfo.localFilesPath)}>
                      ${workspaceInfo.localFilesPath || yo`<em onclick=${onChangeWorkspaceDirectory}>Configure local directory</em>`}
                    </span>

                    ${workspaceInfo.localFilesPath ? yo`
                      <button class="btn copy-btn outline tooltip-container" data-tooltip="Local directory" onclick=${() => onCopy(workspaceInfo.localFilesPath, 'Path copied to clipboard')}>
                        Copy
                      </button>`
                    : ''}
                  </div>
                </div>

                <div class="actions">
                  <button class="btn success full-width" onclick=${onCreateWorkspace}>
                    Start new project
                    <i class="fa fa-plus"></i>
                  </button>
                </div>
              </div>
            </div>
          `)}
        </div>

        <a disabled=${!(workspaceInfo.localFilesPath && workspaceInfo.publishTargetUrl)} target="_blank" href="workspace://${workspaceInfo.name}" class="btn">
          Live preview
          <i class="fa fa-external-link"></i>
        </a>
      </div>

      <div class="bottom">${renderTabs()}</div>
    </div>
  `
}

function renderTabs () {
  return yo`
    <div class="tabs">
      <div onclick=${e => onChangeView('revisions')} class="tab ${activeView === 'revisions' ? 'active' : ''}">
        <i class="fa fa-code"></i>
        Revisions
        ${workspaceInfo.revisions.length ? yo`<span class="revisions-indicator"></span>` : ''}
      </div>

      <div onclick=${e => onChangeView('preview')} class="tab ${activeView === 'preview' ? 'active' : ''}">
        <i class="fa fa-eye"></i>
        Preview
      </div>

      <div onclick=${e => onChangeView('settings')} class="tab ${activeView === 'settings' ? 'active' : ''}">
        <i class="fa fa-cogs"></i>
        Settings
      </div>
    </div>
  `
}

function renderActions () {
  return yo`
    <div class="actions">
      <button onclick=${onRevertChanges} class="btn" disabled=${!(workspaceInfo && workspaceInfo.revisions.length)}>
        Revert${numCheckedRevisions ? ' selected' : ''}
        <i class="fa fa-undo"></i>
      </button>
      <button onclick=${onPublishChanges} class="btn success" disabled=${!(workspaceInfo && workspaceInfo.revisions.length)}>
        Publish${numCheckedRevisions ? ' selected' : ''}
      </button>
    </div>
  `
}

function renderMetadata () {
  return yo`
    <div class="metadata">
      ${workspaceInfo.revisions.length ? yo`
        <span class="changes-count">
          ${workspaceInfo.revisions.length} unpublished ${pluralize(workspaceInfo.revisions.length, 'revision')}
          ${numCheckedRevisions ? `(${numCheckedRevisions} selected)` : ''}
        </span>
      ` : ''}
    </div>
  `
}

function renderView () {
  switch (activeView) {
    case 'revisions':
      return renderRevisionsView()
    case 'settings':
      return renderSettingsView()
    case 'preview':
      return renderPreviewView()
    default:
      return yo`
        <div id="loading-wrapper">
          <div class="loading">
            <div class="spinner"></div>
            Loading...
          </div>
        </div>`
  }
}

function renderOverview() {
  return yo`
    <div class="overview">
      <div class="tip local-files-path">
        <i class="fa fa-lightbulb-o"></i>
        ${workspaceInfo.localFilesPath ? yo`
          <p>Get started by editing your project's files in
            <code onclick=${() => onOpenFolder(workspaceInfo.localFilesPath)}>
              ${workspaceInfo.localFilesPath}
            </code>
          </p>`
        : yo`<p>Get started by <span class="choose-directory" onclick=${onChangeWorkspaceDirectory}>choosing a directory for your project.</p>`}
      </div>

      <div class="tip preview">
        <i class="fa fa-eye"></i>
        <p>
          Preview your project at <code><a href="workspace://${workspaceInfo.name}">workspace://${workspaceInfo.name}</a></code>
        </p>
      </div>

      <div class="tip target-url">
        <i class="fa fa-link"></i>
          <p>
            View your published changes at<br><code><a href="${workspaceInfo.publishTargetUrl}">${workspaceInfo.publishTargetUrl}</a></code>
          </p>
      </div>
    </div>
  `
}

function renderPreviewView () {
  if (!(workspaceInfo.publishTargetUrl && workspaceInfo.localFilesPath)) {
    return yo`
      <div class="view preview">
        Finish configuring this project before previewing your progress.
      </div>
    `
  }

  return yo`
    <div class="view preview">
      <iframe src="workspace://${workspaceInfo.name}"></iframe>
    </div>
  `
}

function renderRevisionsView () {
  const additions = workspaceInfo.revisions.filter(r => r.change === 'add')
  const modifications = workspaceInfo.revisions.filter(r => r.change === 'mod')
  const deletions = workspaceInfo.revisions.filter(r => r.change === 'del')

  const renderRev = node => (
    yo`
      <li class="${currentDiffNode && node.path === currentDiffNode.path ? 'selected' : ''}" onclick=${() => onClickChangedNode(node)} title=${node.path}>
        <code class="path">${node.type === 'file' ? node.path.slice(1) : node.path}</code>
        <input
          type="checkbox"
          checked=${!!node.checked}
          onclick=${e => onToggleChangedNodeChecked(e, node)}
        />
      </li>
    `
  )

  return yo`
    <div class="view revisions">
      <div class="revisions-sidebar">
        ${renderMetadata()}

        ${additions.length ? yo`
          <div>
            <div class="revisions-header additions">
              <h3>Additions</h3>
              <span class="count">${additions.length}</span>
            </div>

            <ul class="revisions-list">
              ${additions.map(renderRev)}
            </ul>
          </div>
        ` : ''}

        ${modifications.length ? yo`
          <div>
            <div class="revisions-header modifications">
              <h3>Modifications</h3>
              <span class="count">${modifications.length}</span>
            </div>

            <ul class="revisions-list">
              ${modifications.map(renderRev)}
            </ul>
          </div>
        ` : ''}

        ${deletions.length ? yo`
          <div>
            <div class="revisions-header deletions">
              <h3>Deletions</h3>
              <span class="count">${deletions.length}</span>
            </div>

            <ul class="revisions-list">
              ${deletions.map(renderRev)}
            </ul>
          </div>
        ` : ''}
        ${!(additions.length || modifications.length || deletions.length)
          ? yo`<em>No revisions</em>`
          : ''}

        ${renderActions()}
      </div>

      <div class="revisions-content">
        ${currentDiffNode ? yo`
          <div class="revisions-content-header">
            <div>
              <i class="fa fa-file-text-o"></i>
              <code class="path">
                ${currentDiffNode.type === 'file' ? currentDiffNode.path.slice(1) : currentDiffNode.path}
              </code>
            </div>

            <div class="changes-count-container">
              <span class="additions-count">${diffAdditions ? `+${diffAdditions}` : ''}</span>
              <span class="deletions-count">${diffDeletions ? `-${diffDeletions}` : ''}</span>
          </div>` : ''}

        ${renderRevisionsContent()}
      </div>
    </div>
  `
}

function renderRevisionsContent () {
  if (diff && diff.invalidEncoding) {
    return yo`
      <div class="binary-diff-placeholder">
        <code>
          1010100111001100
          1110100101110100
          1001010100010111
        </code>
      </div>
    `
  } else if (diff) {
    return renderDiff(diff)
  } else {
    return renderOverview()
  }
}

function renderSettingsView () {
  return yo`
    <div class="view settings">
      <h2>Settings</h2>

      <div class="input-group">
        <label for="name">Local URL</label>
        <p>
          The shortcut for previewing your workspace
        </p>

        <div class="name-input-container">
          <span class="protocol">workspaces://</span>
          <input onkeyup=${onChangeWorkspaceName} name="name" onblur=${onSaveWorkspaceName} value=${tmpWorkspaceName}/>

          ${tmpWorkspaceName !== workspaceInfo.name ? yo`
            <button class="btn primary" onclick=${onSaveWorkspaceName}>
              Save
            </button>`
          : ''}
        </div>
      </div>

      <div>
        <label>Directory</label>
        <p>
          The directory on your computer that contains your project's files
        </p>

        <button class="btn path" onclick=${onChangeWorkspaceDirectory} data-path=${workspaceInfo.localFilesPath || ''}>
          Select ${workspaceInfo.localFilesPath ? 'new' : ''} directory
        </button>
      </div>

      <div>
        <label>Delete workspace</label>

        ${workspaceInfo.localFilesPath ? yo`
          <p>
            Deleting this workspace will <strong>not</strong> delete the files at <code>${workspaceInfo.localFilesPath}</code>
          </p>
        ` : ''}

        <button class="btn warning" onclick=${e => {e.stopPropagation(); onDeleteWorkspace(workspaceInfo.name);}}>
          Delete workspace
          <i class="fa fa-trash"></i>
        </button>
      </div>
    </div>
  `
}