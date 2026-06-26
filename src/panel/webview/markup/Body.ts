export function renderBody(): string {
  return `</head>
<body>
  <main class="page">
  <div class="shell">
    <section id="mainLayout" class="layout">
      <aside class="card connection-card">
        <div class="card-header connection-card-header">
          <div class="connection-card-title-text">
            <div class="card-title">Connections</div>
            <div class="card-subtitle">Quick connect or saved profile</div>
          </div>
        </div>
        <div class="connection-panel-handle connection-collapse-handle" aria-label="Connection Panel Expanded">
          <span class="tooltip-anchor tooltip-above" data-tooltip="Hide Connection Panel">
            <button id="hideConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Hide Connection Panel">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M560-240 320-480l240-240 28 28-212 212 212 212-28 28Z" /></svg>
            </button>
          </span>
        </div>
        <div id="connectionResizeHandle" class="connection-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Connection Panel" aria-valuemin="240" aria-valuemax="390" aria-valuenow="320" data-tooltip="Resize Connection Panel"></div>
        <div class="card-body connection-card-body">
          <div class="connection-profile-section">
            <div class="profile-row">
            <div class="profile-picker-field">
              <label for="profileDropdownButton">Connection profile</label>
              <div class="profile-picker">
                <button id="profileDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="profileDropdownLabel" class="profile-dropdown-label">New / Quick Connection</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="profileDropdownMenu" class="profile-dropdown-menu connection-profile-dropdown-menu" role="listbox" aria-label="Connection Profiles"></div>
              </div>
              <select id="profileSelect" class="profile-select-native" aria-hidden="true" tabindex="-1"><option value="">New / Quick Connection</option></select>
              <input id="profileName" type="hidden" autocomplete="off" />
            </div>
            <button id="manageProfilesButton" type="button" class="secondary manage-profiles-button has-tooltip" aria-label="Manage Saved Connections" data-tooltip="Manage Saved Connections">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-280v-40h560v40H200Zm0-180v-40h560v40H200Zm0-180v-40h560v40H200Z" /></svg>
            </button>
            </div>
          </div>

          <div class="connection-panel-divider" aria-hidden="true"></div>
          <div class="connection-details-scroll">
            <div class="connection-details-title">Connection details</div>
            <div class="form-grid">
            <div>
              <label for="host">Host</label>
              <input id="host" autocomplete="off" />
              <label class="checkbox-row keepalive-row has-tooltip" data-tooltip="Send periodic keepalive messages to reduce idle disconnects."><input id="keepAlive" class="dialog-checkbox" type="checkbox" checked /> Keep connection alive</label>
            </div>
            <div><label for="port">Port</label><input id="port" value="22" inputmode="numeric" /></div>

            <div class="full">
              <label for="connectionTypeDropdownButton">Connection Method</label>
              <div class="connection-type-picker">
                <button id="connectionTypeDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="connectionTypeDropdownLabel" class="profile-dropdown-label">SFTP</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="connectionTypeDropdownMenu" class="profile-dropdown-menu connection-type-dropdown-menu" role="listbox" aria-label="Connection Method">
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="sftp">
                    <span class="profile-dropdown-name">SFTP</span>
                    <span class="profile-dropdown-meta">SSH File Transfer Protocol</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="ftps">
                    <span class="profile-dropdown-name">FTPS</span>
                    <span class="profile-dropdown-meta">FTP over TLS</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="ftp">
                    <span class="profile-dropdown-name">FTP</span>
                    <span class="profile-dropdown-meta">Legacy FTP</span>
                  </button>
                </div>
              </div>
              <select id="connectionType" class="connection-type-select-native" aria-hidden="true" tabindex="-1"><option value="sftp">SFTP</option><option value="ftps">FTPS</option><option value="ftp">FTP</option></select>
              <div id="ftpsCertificateBlock" class="ftps-certificate-block">
                <label class="checkbox-row ftps-self-signed-row has-tooltip" data-tooltip="Accept self-signed or untrusted FTPS certificates for this connection."><input id="ftpsAllowSelfSignedCertificate" class="dialog-checkbox" type="checkbox" /> Allow self-signed/untrusted certificate</label>
                <div id="ftpsCaCertificateBlock">
                  <label for="ftpsCaCertificatePath">CA certificate path</label>
                  <div class="input-with-button">
                    <input id="ftpsCaCertificatePath" autocomplete="off" />
                    <button id="ftpsCaCertificateBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Select CA Certificate File" data-tooltip="Select CA Certificate File">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                    </button>
                  </div>
                  <div class="connection-type-note visible">PEM or CA file for FTPS validation.</div>
                </div>
              </div>
            </div>

            <div class="full"><label for="username">Username</label><input id="username" autocomplete="username" /></div>
            <div id="authMethodBlock" class="full auth-method-block">
              <label for="authDropdownButton">Authentication</label>
              <div class="auth-picker">
                <button id="authDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="authDropdownLabel" class="profile-dropdown-label">Password</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="authDropdownMenu" class="profile-dropdown-menu auth-dropdown-menu" role="listbox" aria-label="Authentication method">
                  <button type="button" class="profile-dropdown-item" role="option" data-auth-type="password">
                    <span class="profile-dropdown-name">Password</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-auth-type="privateKey">
                    <span class="profile-dropdown-name">Private key</span>
                  </button>
                </div>
              </div>
              <select id="authType" class="auth-select-native" aria-hidden="true" tabindex="-1"><option value="password">Password</option><option value="privateKey">Private key</option></select>
            </div>
            <div id="passwordBlock" class="full auth-block visible">
              <label for="password">Password</label>
              <div class="input-with-button">
                <input id="password" type="password" autocomplete="current-password" />
                <button id="passwordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password" data-tooltip="Hold to Show Password">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                </button>
              </div>
              <label class="checkbox-row"><input id="rememberPassword" class="dialog-checkbox" type="checkbox" /> Remember password securely</label>
              <div id="passwordSecretState" class="credential-state not-saved">Password not saved.</div>
            </div>
            <div id="privateKeyBlock" class="full auth-block">
              <label for="privateKeyPath">Private key path</label>
              <div class="input-with-button">
                <input id="privateKeyPath" placeholder="~/.ssh/id_rsa" autocomplete="off" />
                <button id="privateKeyBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Select Private Key File" data-tooltip="Select Private Key File">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
            </div>
            <div id="passphraseBlock" class="full auth-block">
              <label for="passphrase">Passphrase</label>
              <div class="input-with-button">
                <input id="passphrase" type="password" autocomplete="off" />
                <button id="passphraseRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Passphrase" data-tooltip="Hold to Show Passphrase">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                </button>
              </div>
              <label class="checkbox-row"><input id="rememberPassphrase" class="dialog-checkbox" type="checkbox" /> Remember passphrase securely</label>
              <div id="passphraseSecretState" class="credential-state not-saved">Passphrase not saved.</div>
            </div>

            <div class="full"><label for="startPath">Start path</label><input id="startPath" autocomplete="off" /></div>
            </div>
          </div>

          <div class="connection-panel-divider" aria-hidden="true"></div>
          <div class="connection-actions-section">
            <div class="button-row connection-actions">
              <button id="connectButton" class="connection-action-full">Connect</button>
              <button id="saveProfileButton" class="secondary connection-action-full">Save</button>
              <button id="showSettingsButton" class="secondary">Settings</button>
              <button id="showOutputButton" class="secondary">Output</button>
            </div>
          </div>
        </div>
      </aside>

      <aside class="connection-panel-handle connection-rail" aria-label="Connection Panel Collapsed">
        <span class="tooltip-anchor" data-tooltip="Show Connection Panel">
          <button id="showConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Show Connection Panel">
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m400-240-28-28 212-212-212-212 28-28 240 240-240 240Z" /></svg>
          </button>
        </span>
      </aside>

      <section class="browser-column">
        <section class="card browser-card">
          <div class="browser-open-section" aria-label="Active Remote Connections">
            <div class="open-connections-row">
              <div class="session-strip browser-session-strip">
                <div id="sessionTabs" class="session-tabs"></div>
                <div id="sessionTabsScrollbar" class="session-tabs-scrollbar" aria-hidden="true" hidden>
                  <div id="sessionTabsScrollbarThumb" class="session-tabs-scrollbar-thumb"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="browser-section-divider"></div>
          <div id="browserSubtitle" hidden>Connect to a host to list remote files.</div>

          <div class="card-body">
          <div class="pathbar">
            <div id="remotePathBox" class="remote-path-box">
              <input id="currentPath" value="" disabled aria-label="Remote Path" data-tooltip="Remote Path" />
              <div class="remote-path-navigation-buttons" aria-hidden="false">
                <button id="remotePathBackButton" class="remote-path-navigation-button" type="button" aria-label="Go Back" data-tooltip="Go Back" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M313.15-460H760v-40H313.15l211.69-211.69L496-740 236-480l260 260 28.84-28.31L313.15-460Z" /></svg></button>
                <button id="remotePathForwardButton" class="remote-path-navigation-button" type="button" aria-label="Go Forward" data-tooltip="Go Forward" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M646.85-460H200v-40h446.85L435.16-711.69 464-740l260 260-260 260-28.84-28.31L646.85-460Z" /></svg></button>
              </div>
              <span class="remote-path-leading-icon" aria-hidden="true"><svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12 11.5C12 11.5989 11.9707 11.6956 11.9157 11.7778C11.8608 11.86 11.7827 11.9241 11.6913 11.9619C11.6 11.9998 11.4994 12.0097 11.4025 11.9904C11.3055 11.9711 11.2164 11.9235 11.1464 11.8536C11.0765 11.7836 11.0289 11.6945 11.0096 11.5975C10.9903 11.5006 11.0002 11.4 11.0381 11.3087C11.0759 11.2173 11.14 11.1392 11.2222 11.0843C11.3044 11.0293 11.4011 11 11.5 11C11.6326 11 11.7598 11.0527 11.8536 11.1464C11.9473 11.2402 12 11.3674 12 11.5ZM11.5 8C11.5989 8 11.6956 7.97068 11.7778 7.91573C11.86 7.86079 11.9241 7.7827 11.9619 7.69134C11.9998 7.59998 12.0097 7.49945 11.9904 7.40245C11.9711 7.30546 11.9235 7.21637 11.8536 7.14645C11.7836 7.07652 11.6945 7.0289 11.5975 7.00961C11.5006 6.99031 11.4 7.00022 11.3087 7.03806C11.2173 7.0759 11.1392 7.13999 11.0843 7.22221C11.0293 7.30444 11 7.40111 11 7.5C11 7.63261 11.0527 7.75979 11.1464 7.85355C11.2402 7.94732 11.3674 8 11.5 8ZM14 4.5C13.999 4.87026 13.86 5.22685 13.61 5.5C13.86 5.77315 13.999 6.12974 14 6.5V8.5C13.999 8.87026 13.86 9.22685 13.61 9.5C13.86 9.77315 13.999 10.1297 14 10.5V12.5C14 12.8978 13.842 13.2794 13.5607 13.5607C13.2794 13.842 12.8978 14 12.5 14H3.5C3.10218 14 2.72064 13.842 2.43934 13.5607C2.15804 13.2794 2 12.8978 2 12.5V10.5C2.00097 10.1297 2.14003 9.77315 2.39 9.5C2.14003 9.22685 2.00097 8.87026 2 8.5V6.5C2.00097 6.12974 2.14003 5.77315 2.39 5.5C2.14003 5.22685 2.00097 4.87026 2 4.5V2.5C2 2.10218 2.15804 1.72064 2.43934 1.43934C2.72064 1.15804 3.10218 1 3.5 1H12.5C12.8978 1 13.2794 1.15804 13.5607 1.43934C13.842 1.72064 14 2.10218 14 2.5V4.5ZM3 4.5C3 4.63261 3.05268 4.75979 3.14645 4.85355C3.24021 4.94732 3.36739 5 3.5 5H12.5C12.6326 5 12.7598 4.94732 12.8536 4.85355C12.9473 4.75979 13 4.63261 13 4.5V2.5C13 2.36739 12.9473 2.24021 12.8536 2.14645C12.7598 2.05268 12.6326 2 12.5 2H3.5C3.36739 2 3.24021 2.05268 3.14645 2.14645C3.05268 2.24021 3 2.36739 3 2.5V4.5ZM12.5 6H3.5C3.36739 6 3.24021 6.05268 3.14645 6.14645C3.05268 6.24021 3 6.36739 3 6.5V8.5C3 8.63261 3.05268 8.75979 3.14645 8.85355C3.24021 8.94732 3.36739 9 3.5 9H12.5C12.6326 9 12.7598 8.94732 12.8536 8.85355C12.9473 8.75979 13 8.63261 13 8.5V6.5C13 6.36739 12.9473 6.24021 12.8536 6.14645C12.7598 6.05268 12.6326 6 12.5 6ZM13 10.5C13 10.3674 12.9473 10.2402 12.8536 10.1464C12.7598 10.0527 12.6326 10 12.5 10H3.5C3.36739 10 3.24021 10.0527 3.14645 10.1464C3.05268 10.2402 3 10.3674 3 10.5V12.5C3 12.6326 3.05268 12.7598 3.14645 12.8536C3.24021 12.9473 3.36739 13 3.5 13H12.5C12.6326 13 12.7598 12.9473 12.8536 12.8536C12.9473 12.7598 13 12.6326 13 12.5V10.5ZM11.5 4C11.5989 4 11.6956 3.97068 11.7778 3.91573C11.86 3.86079 11.9241 3.7827 11.9619 3.69134C11.9998 3.59998 12.0097 3.49945 11.9904 3.40245C11.9711 3.30546 11.9235 3.21637 11.8536 3.14645C11.7836 3.07652 11.6945 3.0289 11.5975 3.00961C11.5006 2.99031 11.4 3.00022 11.3087 3.03806C11.2173 3.0759 11.1392 3.13999 11.0843 3.22221C11.0293 3.30444 11 3.40111 11 3.5C11 3.63261 11.0527 3.75979 11.1464 3.85355C11.2402 3.94732 11.3674 4 11.5 4Z"/></svg></span>
              <div id="remotePathBreadcrumb" class="remote-path-inline-breadcrumb" aria-label="Remote Path Breadcrumb"></div>
              <div id="remotePathDropdown" class="remote-path-dropdown" aria-hidden="true"></div>
              <div class="remote-path-favorite-buttons" aria-hidden="false">
                <button id="goButton" class="remote-path-favorite-button remote-path-action-button refresh-mode" type="button" aria-label="Refresh Current Directory" data-tooltip="Refresh Current Directory" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg></button>
                <button id="togglePathFavoriteButton" class="remote-path-favorite-button" type="button" aria-label="Add Remote Path Favorite" data-tooltip="Save This Connection to Use Remote Path Favorites" disabled>
                  <svg class="star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08ZM480-470Z" /></svg>
                  <svg class="filled-star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m293-203.08 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08Z" /></svg>
                </button>
                <button id="pathFavoritesButton" class="remote-path-favorite-button" type="button" aria-label="Show Remote Path Favorites" data-tooltip="Save This Connection to Use Remote Path Favorites" disabled>
                  <svg class="hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM294-287l126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Zm187-257.69Z" /></svg>
                  <svg class="filled-hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM233-203.08l49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Z" /></svg>
                </button>
              </div>
              <div id="pathFavoritesPopover" class="remote-path-favorites-popover" aria-hidden="true">
                <div class="remote-path-favorites-title">Favorite remote paths</div>
                <div id="pathFavoritesList"></div>
              </div>
            </div>
            <div id="remotePathResizeHandle" class="remote-path-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Remote Path" aria-valuemin="400" tabindex="0"></div>
            <div id="serverToolbarStatus" class="server-toolbar-status" role="status" aria-live="polite"></div>
            <div id="serverAutoRefreshCountdown" class="server-auto-refresh-countdown" aria-hidden="true" hidden></div>
            <div id="filterBox" class="filter-box">
              <input id="filterInput" class="filter-input" placeholder="Filter Files..." aria-label="Filter Files" disabled />
              <button id="clearFilterButton" class="filter-clear-button has-tooltip" aria-label="Clear Filter" data-tooltip="Clear Filter" disabled><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button>
            </div>
            <div id="serverRefreshActions" class="path-actions server-refresh-actions" aria-label="Server Refresh Controls">
              <span class="tooltip-anchor" data-tooltip="Refresh Server Dashboard">
                <button id="serverRefreshButton" class="secondary icon-only" type="button" aria-label="Refresh Server Dashboard" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg></button>
              </span>
              <div id="serverAutoRefreshPicker" class="server-auto-refresh-picker">
                <button id="serverAutoRefreshDropdownButton" type="button" class="profile-dropdown-button server-auto-refresh-button has-tooltip" aria-haspopup="listbox" aria-expanded="false" aria-label="Server Auto Refresh" data-tooltip="Server Auto Refresh" disabled>
                  <span id="serverAutoRefreshDropdownLabel" class="profile-dropdown-label">Auto: 30s</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="serverAutoRefreshDropdownMenu" class="profile-dropdown-menu server-auto-refresh-menu" role="listbox" aria-label="Server Auto Refresh">
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="off"><span class="profile-dropdown-name">Auto: Off</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="15"><span class="profile-dropdown-name">Auto: 15s</span></button>
                  <button type="button" class="profile-dropdown-item selected" role="option" aria-selected="true" data-server-auto-refresh="30"><span class="profile-dropdown-name">Auto: 30s</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="60"><span class="profile-dropdown-name">Auto: 1m</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="300"><span class="profile-dropdown-name">Auto: 5m</span></button>
                </div>
              </div>
            </div>
            <span id="serverRefreshActionsSeparator" class="toolbar-separator filter-sudo-separator server-refresh-separator" aria-hidden="true"></span>
            <span id="commandActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div id="commandActions" class="path-actions command-actions">
              <span class="tooltip-anchor remote-search-button-wrap" data-tooltip="Remote Search">
                <button id="remoteSearchButton" class="secondary icon-only" type="button" aria-label="Remote Search" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.18 10.43l4.45 4.44-.71.71-4.44-4.45A6.5 6.5 0 1 1 10.5 4Zm0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" /></svg><span id="remoteSearchBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
              <span id="runRemoteCommandAction" class="tooltip-anchor remote-search-button-wrap" data-tooltip="Run Remote Command">
                <button id="runRemoteCommandButton" class="secondary icon-only" type="button" aria-label="Run Remote Command" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.5 13.8845 9.6923 9.6923 5.5 5.5l-.7078.7078 3.4848 3.4845-3.4848 3.4845L5.5 13.8845ZM12 18v-1h8v1h-8Z" /></svg><span id="remoteCommandBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
              <span id="openSshTerminalAction" class="tooltip-anchor" data-tooltip="Open SSH Terminal">
                <button id="openSshTerminalButton" class="secondary icon-only" type="button" aria-label="Open SSH Terminal" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5C4 4.6716 4.6716 4 5.5 4h13c.8284 0 1.5.6716 1.5 1.5v13c0 .8284-.6716 1.5-1.5 1.5h-13C4.6716 20 4 19.3284 4 18.5v-13ZM5.5 5C5.2239 5 5 5.2239 5 5.5v13c0 .2761.2239.5.5.5h13c.2761 0 .5-.2239.5-.5v-13c0-.2761-.2239-.5-.5-.5h-13Zm2.8536 4.1464L11.2071 12l-2.8535 2.8536-.7072-.7072L9.7929 12 7.6464 9.8536l.7072-.7072ZM12 15h5v1h-5v-1Z" /></svg></button>
              </span>
              <span id="openLogViewerAction" class="tooltip-anchor remote-search-button-wrap" data-tooltip="Log Viewer">
                <button id="openLogViewerButton" class="secondary icon-only" type="button" aria-label="Log Viewer" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4h14v16H5V4Zm1 1v14h12V5H6Zm2 3h8v1H8V8Zm0 3h8v1H8v-1Zm0 3h5v1H8v-1Z" /></svg><span id="logViewerBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
            </div>
            <span id="transferActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div class="path-actions transfer-actions">
              <span id="downloadAction" class="tooltip-anchor" data-tooltip="Download Selected Files or Folders">
                <button id="downloadButton" class="secondary icon-only" aria-label="Download Selected Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm220-146L314-472l28-28 118 118v-370h40v370l118-118 28 28-166 166Z" /></svg></button>
              </span>
              <span id="uploadAction" class="tooltip-anchor" data-tooltip="Upload Files or Folders">
                <button id="uploadButton" class="secondary icon-only" aria-label="Upload Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm200-160v-370L342-572l-28-28 166-166 166 166-28 28-118-118v370h-40Z" /></svg></button>
              </span>
              <span id="transferQueueTooltip" class="tooltip-anchor" data-tooltip="Transfer Queue">
                <button id="transferQueueButton" class="secondary icon-only transfer-queue-button" type="button" aria-label="Transfer Queue"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M340-596.38h40v359.3l83.54-83.54 28.77 28.31L360-160 227.69-292.31l28.77-28.31L340-237.08v-359.3ZM620-421h-40v-302.38l-84 84-28.31-28.31L600-800l132.31 132.31L704-639.38l-84-84V-421Z" /></svg><span id="transferQueueCount" class="transfer-queue-count" aria-hidden="true">0</span></button>
              </span>
            </div>
            <span id="sudoToggleSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <label id="sudoToggleLabel" class="sudo-toggle has-tooltip disabled" data-tooltip="Enable Sudo Mode">
              <input id="sudoToggle" type="checkbox" disabled aria-label="Enable Sudo Mode" />
              <svg id="sudoToggleState" class="sudo-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <text x="12" y="13.2" text-anchor="middle">SU</text>
              </svg>
            </label>
            <span class="toolbar-separator view-switch-separator" aria-hidden="true"></span>
            <div class="connection-view-switch pathbar-view-switch" role="tablist" aria-label="Connection View">
              <button class="connection-view-switch-button active" type="button" role="tab" aria-selected="true" aria-controls="filesView" data-connection-view="files">Files</button>
              <button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="serverView" data-connection-view="server">Server</button>
            </div>
          </div>

          <div id="filesView" class="connection-view files-view">
            <div id="entriesTableWrap" class="table-wrap">
            <table id="entriesTable">
              <colgroup>
                <col data-column="name" />
                <col data-column="type" />
                <col data-column="size" />
                <col data-column="owner" />
                <col data-column="group" />
                <col data-column="permissions" />
                <col data-column="modified" />
              </colgroup>
              <thead><tr>
                <th class="sortable" data-sort-key="name" data-column="name"><span class="header-content"><span class="header-label">Name</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="name"></span></th>
                <th class="sortable type" data-sort-key="type" data-column="type"><span class="header-content"><span class="header-label">Type</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="type"></span></th>
                <th class="sortable size" data-sort-key="size" data-column="size"><span class="header-content"><span class="header-label">Size</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="size"></span></th>
                <th class="sortable owner" data-sort-key="owner" data-column="owner"><span class="header-content"><span class="header-label">Owner</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="owner"></span></th>
                <th class="sortable group" data-sort-key="group" data-column="group"><span class="header-content"><span class="header-label">Group</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="group"></span></th>
                <th class="sortable permissions" data-sort-key="permissions" data-column="permissions"><span class="header-content"><span class="header-label">Permissions</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="permissions"></span></th>
                <th class="sortable modified" data-sort-key="modified" data-column="modified"><span class="header-content"><span class="header-label">Modified</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="modified"></span></th>
              </tr></thead>
              <tbody id="entriesBody"><tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr></tbody>
            </table>
          </div>
          <div id="status" class="statusbar"><div class="status-main"><div id="statusText" class="status-text">Ready.</div><button id="statusOutputLink" class="status-output-link" type="button" hidden>See details in Output.</button><div class="spinner" aria-hidden="true"></div></div><div class="status-actions"><button id="statusCancelButton" class="status-action-button status-cancel-button has-tooltip tooltip-above" type="button" aria-label="Cancel Current Operation" data-tooltip="Cancel Current Operation" hidden>Cancel</button><div class="status-copy-wrap"><button id="statusCopyButton" class="status-action-button status-copy-button has-tooltip tooltip-above" type="button" aria-label="Copy Status" data-tooltip="Copy Status"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg></button><div id="statusCopyFeedback" class="status-copy-feedback" role="status" aria-live="polite">Copied</div></div></div></div>
          </div>
          <div id="serverView" class="connection-view server-view hidden" aria-label="Server dashboard">
            <div id="serverViewContent" class="server-dashboard"></div>
          </div>
          </div>
        </section>
      </section>
    </section>
  </div>
  </main>

  <div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>
  <div id="inputPromptBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="inputPromptTitle" aria-hidden="true">
    <section class="file-properties-dialog input-prompt-dialog">
      <div class="file-properties-header">
        <h2 id="inputPromptTitle" class="file-properties-title">Input</h2>
        <div id="inputPromptMessage" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <label id="inputPromptLabel" for="inputPromptInput">Input</label>
        <div id="inputPromptInputWrap" class="input-with-button reveal-hidden">
          <input id="inputPromptInput" type="text" autocomplete="off" />
          <button id="inputPromptRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password" data-tooltip="Hold to Show Password" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.3 3 1.73 6.11 1 8c.73 1.89 3.3 5 7 5s6.27-3.11 7-5c-.73-1.89-3.3-5-7-5Zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7Zm0-1.25A2.25 2.25 0 1 0 8 5.75a2.25 2.25 0 0 0 0 4.5Z" /></svg>
          </button>
        </div>
        <div id="inputPromptFeedback" class="input-prompt-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="inputPromptCancelButton" type="button" class="secondary">Cancel</button>
        <button id="inputPromptConfirmButton" type="button">OK</button>
      </div>
    </section>
  </div>


  <div id="serverOverviewDetailsBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverOverviewDetailsTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="serverOverviewDetailsTitle" class="file-properties-title">Overview Details</h2>
        <div id="serverOverviewDetailsSubtitle" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div id="serverOverviewDetailsGrid" class="file-properties-grid"></div>
      </div>
      <div class="file-properties-actions">
        <button id="serverOverviewDetailsCopyButton" type="button" class="secondary">Copy</button>
        <button id="serverOverviewDetailsCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>


  <div id="serverLogShortcutBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverLogShortcutTitle" aria-hidden="true">
    <section class="file-properties-dialog server-log-shortcut-dialog">
      <div class="file-properties-header">
        <h2 id="serverLogShortcutTitle" class="file-properties-title">Add Log Shortcut</h2>
        <div id="serverLogShortcutSubtitle" class="file-properties-path">Create a shortcut to a remote log file.</div>
      </div>
      <div class="file-properties-body">
        <div class="server-log-shortcut-fields">
          <div class="server-log-shortcut-field">
            <label for="serverLogShortcutNameInput">Name</label>
            <input id="serverLogShortcutNameInput" type="text" autocomplete="off" placeholder="Nginx error" />
          </div>
          <div class="server-log-shortcut-field">
            <label for="serverLogShortcutPathInput">Remote log path</label>
            <div class="server-log-shortcut-path-wrap">
              <input id="serverLogShortcutPathInput" type="text" autocomplete="off" placeholder="/var/log/nginx/error.log" />
              <button id="serverLogShortcutBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Log File" data-tooltip="Browse Remote Log File">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4l2 2h8v12H4V4h6Zm-5 3v10h14V7H5Z" /></svg>
              </button>
              <div id="serverLogShortcutPathPicker" class="remote-search-scope-picker server-log-shortcut-picker hidden" aria-hidden="true">
                <div class="remote-search-scope-picker-header">
                  <div id="serverLogShortcutPathPickerPath" class="remote-search-scope-picker-path">/var/log</div>
                  <div class="remote-search-scope-picker-actions">
                    <button id="serverLogShortcutPathPickerCancelButton" class="secondary" type="button">Cancel</button>
                  </div>
                </div>
                <div id="serverLogShortcutPathPickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
              </div>
            </div>
          </div>
          <div id="serverLogShortcutFeedback" class="server-log-shortcut-feedback" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="serverLogShortcutRemoveButton" type="button" class="secondary danger modal-action-left" hidden>Remove</button>
        <button id="serverLogShortcutCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverLogShortcutSaveButton" type="button">Add</button>
      </div>
    </section>
  </div>

  <div id="serverLogShortcutRemoveBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverLogShortcutRemoveTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="serverLogShortcutRemoveTitle" class="file-properties-title">Remove Log Shortcut</h2>
        <div class="file-properties-path">This will only remove the shortcut from Remote Edit. The remote log file will not be deleted.</div>
      </div>
      <div class="file-properties-body">
        <div id="serverLogShortcutRemovePath" class="server-log-shortcut-remove-path"></div>
      </div>
      <div class="file-properties-actions">
        <button id="serverLogShortcutRemoveCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverLogShortcutRemoveConfirmButton" type="button" class="danger">Remove</button>
      </div>
    </section>
  </div>


  <div id="serverPortForwardBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverPortForwardTitle" aria-hidden="true">
    <section class="file-properties-dialog server-port-forward-dialog">
      <div class="file-properties-header">
        <h2 id="serverPortForwardTitle" class="file-properties-title">Add Port Forward</h2>
        <div id="serverPortForwardSubtitle" class="file-properties-path">Create a local SSH port forward for this connection.</div>
      </div>
      <div class="file-properties-body">
        <div class="server-port-forward-fields">
          <div class="server-port-forward-field">
            <label for="serverPortForwardNameInput">Name</label>
            <input id="serverPortForwardNameInput" type="text" autocomplete="off" placeholder="My App" />
          </div>
          <div class="server-port-forward-field-grid">
            <div class="server-port-forward-field">
              <label for="serverPortForwardLocalHostInput">Local host</label>
              <input id="serverPortForwardLocalHostInput" type="text" autocomplete="off" placeholder="localhost" />
            </div>
            <div class="server-port-forward-field">
              <label for="serverPortForwardLocalPortInput">Local port</label>
              <input id="serverPortForwardLocalPortInput" type="text" inputmode="numeric" autocomplete="off" placeholder="3000" />
            </div>
          </div>
          <div class="server-port-forward-field-grid">
            <div class="server-port-forward-field">
              <label for="serverPortForwardRemoteHostInput">Remote host</label>
              <input id="serverPortForwardRemoteHostInput" type="text" autocomplete="off" placeholder="127.0.0.1" />
            </div>
            <div class="server-port-forward-field">
              <label for="serverPortForwardRemotePortInput">Remote port</label>
              <input id="serverPortForwardRemotePortInput" type="text" inputmode="numeric" autocomplete="off" placeholder="3000" />
            </div>
          </div>
          <label class="modal-checkbox-line server-port-forward-option"><input id="serverPortForwardAutoStartInput" class="dialog-checkbox" type="checkbox" /> <span>Auto-start on connect</span></label>
          <div id="serverPortForwardRunningNote" class="server-port-forward-running-note" hidden>Stop the port forward before editing local or remote ports.</div>
          <div class="server-port-forward-help">Local forwarding maps localhost:LOCAL_PORT on your computer to REMOTE_HOST:REMOTE_PORT from the remote server.</div>
          <div id="serverPortForwardFeedback" class="server-port-forward-feedback" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="serverPortForwardDeleteButton" type="button" class="secondary danger modal-action-left" hidden>Delete</button>
        <button id="serverPortForwardCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverPortForwardSaveButton" type="button">Save</button>
      </div>
    </section>
  </div>

  <div id="serverPortForwardRemoveBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverPortForwardRemoveTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="serverPortForwardRemoveTitle" class="file-properties-title">Delete Port Forward</h2>
        <div class="file-properties-path">This will only remove the saved forward from Remote Edit.</div>
      </div>
      <div class="file-properties-body">
        <div id="serverPortForwardRemovePath" class="server-port-forward-remove-path"></div>
      </div>
      <div class="file-properties-actions">
        <button id="serverPortForwardRemoveCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverPortForwardRemoveConfirmButton" type="button" class="danger">Delete</button>
      </div>
    </section>
  </div>

  <div id="connectionNameBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="connectionNameTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="connectionNameTitle" class="file-properties-title">Save Connection</h2>
        <div class="file-properties-path">Choose a unique name and optional group for this saved connection.</div>
      </div>
      <div class="file-properties-body">
        <label for="connectionNameInput">Connection name</label>
        <input id="connectionNameInput" autocomplete="off" placeholder="Production Server" />
        <label for="connectionNameGroupDropdownButton" class="connection-name-group-label">Connection group</label>
        <div id="connectionNameGroupPicker" class="connection-name-group-picker">
          <button id="connectionNameGroupDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
            <span id="connectionNameGroupDropdownLabel" class="profile-dropdown-label">No group</span>
            <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
          </button>
          <input id="connectionNameGroupNewInput" class="connection-name-group-new-input" autocomplete="off" placeholder="New group name" hidden />
          <div id="connectionNameGroupDropdownMenu" class="profile-dropdown-menu connection-name-group-dropdown-menu" role="listbox" aria-label="Connection group"></div>
        </div>
        <input id="connectionNameGroup" type="hidden" value="" />
        <div id="connectionNameFeedback" class="connection-name-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="connectionNameCancelButton" type="button" class="secondary">Cancel</button>
        <button id="connectionNameCreateButton" type="button">Save</button>
      </div>
    </section>
  </div>

  <div id="manageProfilesBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="manageProfilesTitle" aria-hidden="true">
    <section class="file-properties-dialog manage-profiles-dialog">
      <div class="file-properties-header manage-profiles-header-row">
        <div>
          <h2 id="manageProfilesTitle" class="file-properties-title">Manage Saved Connections</h2>
          <div class="file-properties-path">Rename, reorder, or remove saved connection profiles.</div>
        </div>
        <div class="manage-profiles-header-actions">
          <button id="manageProfilesImportButton" class="secondary" type="button">Import</button>
          <button id="manageProfilesExportButton" class="secondary" type="button">Export</button>
        </div>
      </div>
      <div class="file-properties-body">
        <div id="manageProfilesFeedback" class="manage-profiles-feedback" role="status" aria-live="polite"></div>
        <div class="manage-profiles-toolbar">
          <div id="manageProfilesFilterBox" class="manage-profiles-filter filter-box">
            <input id="manageProfilesFilterInput" class="filter-input" type="text" placeholder="Filter connections..." aria-label="Filter Saved Connections" autocomplete="off" />
            <button id="manageProfilesFilterClearButton" class="filter-clear-button has-tooltip" type="button" aria-label="Clear Filter" data-tooltip="Clear Filter" disabled><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button>
          </div>
          <div class="manage-profiles-toolbar-separator" aria-hidden="true"></div>
          <div class="manage-profiles-toolbar-actions">
            <button id="manageProfilesExpandAllButton" class="secondary manage-profile-icon-button manage-profiles-group-action-button has-tooltip" type="button" aria-label="Expand all groups" data-tooltip="Expand all groups"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M15 6V11C15 13.21 13.21 15 11 15H6C5.26 15 4.62 14.6 4.27 14H11C12.65 14 14 12.65 14 11V4.27C14.6 4.62 15 5.26 15 6ZM11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13ZM4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12ZM9.5 7H8V5.5C8 5.224 7.776 5 7.5 5C7.224 5 7 5.224 7 5.5V7H5.5C5.224 7 5 7.224 5 7.5C5 7.776 5.224 8 5.5 8H7V9.5C7 9.776 7.224 10 7.5 10C7.776 10 8 9.776 8 9.5V8H9.5C9.776 8 10 7.776 10 7.5C10 7.224 9.776 7 9.5 7Z"></path></svg></button>
            <button id="manageProfilesCollapseAllButton" class="secondary manage-profile-icon-button manage-profiles-group-action-button has-tooltip" type="button" aria-label="Collapse all groups" data-tooltip="Collapse all groups"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z"></path><path d="M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z"></path></svg></button>
            <button id="manageProfilesAddGroupButton" class="secondary" type="button">+ Group</button>
          </div>
        </div>
        <div id="manageProfilesList" class="manage-profiles-list"></div>
      </div>
      <div class="file-properties-actions">
        <button id="manageProfilesCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>

  <div id="manageGroupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="manageGroupTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="manageGroupTitle" class="file-properties-title">New Group</h2>
        <div id="manageGroupSubtitle" class="file-properties-path">Create a saved connection group.</div>
      </div>
      <div class="file-properties-body">
        <label for="manageGroupNameInput">Group name</label>
        <input id="manageGroupNameInput" autocomplete="off" placeholder="Production" />
        <div id="manageGroupFeedback" class="connection-name-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="manageGroupCancelButton" type="button" class="secondary">Cancel</button>
        <button id="manageGroupSaveButton" type="button">Create</button>
      </div>
    </section>
  </div>

  <div id="manageGroupRemoveBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="manageGroupRemoveTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog manage-group-remove-dialog">
      <div class="file-properties-header">
        <h2 id="manageGroupRemoveTitle" class="file-properties-title">Remove Group</h2>
        <div id="manageGroupRemoveSubtitle" class="file-properties-path">Choose what to do with the connections in this group.</div>
      </div>
      <div class="file-properties-body">
        <div id="manageGroupRemoveName" class="manage-group-remove-name"></div>
        <div class="manage-group-remove-options">
          <label class="modal-checkbox-line manage-group-remove-option">
            <input id="manageGroupRemoveOnlyRadio" name="manageGroupRemoveMode" type="radio" value="group" checked>
            <span>
              <span class="manage-group-remove-option-title">Remove group only</span>
              <span class="modal-helper-text">Connections will be kept and moved out of the group.</span>
            </span>
          </label>
          <label class="modal-checkbox-line manage-group-remove-option">
            <input id="manageGroupRemoveConnectionsRadio" name="manageGroupRemoveMode" type="radio" value="connections">
            <span>
              <span class="manage-group-remove-option-title">Remove group and connections</span>
              <span id="manageGroupRemoveConnectionsHelp" class="modal-helper-text">Saved connections inside this group will also be removed.</span>
            </span>
          </label>
        </div>
        <div id="manageGroupRemoveFeedback" class="connection-name-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="manageGroupRemoveCancelButton" type="button" class="secondary">Cancel</button>
        <button id="manageGroupRemoveConfirmButton" type="button" class="danger">Remove</button>
      </div>
    </section>
  </div>


  <div id="exportBackupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="exportBackupTitle" aria-hidden="true">
    <section class="file-properties-dialog backup-dialog export-backup-dialog">
      <div class="file-properties-header">
        <h2 id="exportBackupTitle" class="file-properties-title">Export Connections and Settings</h2>
        <div class="file-properties-path">Export Remote Edit data to a JSON backup file.</div>
      </div>
      <div class="file-properties-body">
        <section class="backup-section">
          <p class="backup-section-title">Export content</p>
          <div class="backup-checkbox-list">
            <label class="modal-checkbox-line"><input id="exportIncludeSettings" class="dialog-checkbox" type="checkbox" checked> Remote Edit settings</label>
            <div class="modal-checkbox-block">
              <label class="modal-checkbox-line"><input id="exportIncludeConnections" class="dialog-checkbox" type="checkbox" checked> Saved connections</label>
              <div class="backup-child-options">
                <label class="modal-checkbox-line"><input id="exportIncludeFavorites" class="dialog-checkbox" type="checkbox" checked> Remote Path favorites</label>
                <label class="modal-checkbox-line"><input id="exportIncludeUsernames" class="dialog-checkbox" type="checkbox" checked> Include usernames</label>
                <label class="modal-checkbox-line"><input id="exportIncludeCredentials" class="dialog-checkbox" type="checkbox"> Include encrypted passwords/passphrases</label>
                <div id="exportCredentialsBlock" class="backup-credential-block">
                  <div class="modal-helper-text">Encrypt saved passwords and key passphrases. Private key files are not exported.</div>
                  <div class="backup-credential-fields">
                    <label>Export password
                      <div class="input-with-button">
                        <input id="exportCredentialPassword" type="password" autocomplete="new-password">
                        <button id="exportCredentialPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Export Password" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="exportCredentialPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                    <label>Confirm password
                      <div class="input-with-button">
                        <input id="exportCredentialConfirmPassword" type="password" autocomplete="new-password">
                        <button id="exportCredentialConfirmPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password Confirmation" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="exportCredentialConfirmPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                  </div>
                </div>
                <div id="exportCredentialsDisabledHelp" class="modal-helper-text modal-checkbox-helper"></div>
              </div>
            </div>
          </div>
        </section>
        <div id="exportBackupResult" class="backup-result" role="status" aria-live="polite"></div>
        <div id="exportBackupValidation" class="backup-validation" role="alert"></div>
      </div>
      <div class="file-properties-actions">
        <button id="exportBackupCancelButton" class="secondary" type="button">Close</button>
        <button id="exportBackupApplyButton" type="button">Export</button>
      </div>
    </section>
  </div>

  <div id="importBackupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="importBackupTitle" aria-hidden="true">
    <section class="file-properties-dialog backup-dialog import-backup-dialog">
      <div class="file-properties-header">
        <h2 id="importBackupTitle" class="file-properties-title">Import Connections and Settings</h2>
        <div class="file-properties-path">Review the backup content before importing.</div>
      </div>
      <div class="file-properties-body">
        <section class="backup-section backup-summary-section">
          <p class="backup-section-title">Backup summary</p>
          <div id="importBackupSummary" class="backup-summary-line"></div>
        </section>
        <section class="backup-section">
          <p class="backup-section-title">Import content</p>
          <div class="backup-checkbox-list">
            <label class="modal-checkbox-line"><input id="importIncludeSettings" class="dialog-checkbox" type="checkbox" checked> Remote Edit settings</label>
            <div class="modal-checkbox-block">
              <label class="modal-checkbox-line"><input id="importIncludeConnections" class="dialog-checkbox" type="checkbox" checked> Saved connections</label>
              <div class="backup-child-options">
                <label class="modal-checkbox-line"><input id="importIncludeFavorites" class="dialog-checkbox" type="checkbox" checked> Remote Path favorites</label>
                <label class="modal-checkbox-line"><input id="importIncludeUsernames" class="dialog-checkbox" type="checkbox" checked> Include usernames</label>
                <label class="modal-checkbox-line"><input id="importRestoreCredentials" class="dialog-checkbox" type="checkbox"> Restore encrypted passwords/passphrases</label>
                <div id="importCredentialsBlock" class="backup-credential-block">
                  <div class="modal-helper-text">Restore saved passwords and key passphrases. Private key files are not included.</div>
                  <div class="backup-credential-fields">
                    <label>Export password
                      <div class="input-with-button">
                        <input id="importCredentialPassword" type="password" autocomplete="current-password">
                        <button id="importCredentialPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Export Password" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="importCredentialPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                  </div>
                </div>
                <div id="importCredentialsDisabledHelp" class="modal-helper-text modal-checkbox-helper"></div>
              </div>
            </div>
            <div id="importModeBlock" class="backup-import-mode">
              <p class="backup-import-mode-title">Import mode</p>
              <label class="modal-checkbox-line"><input id="importModeMerge" name="importMode" type="radio" value="merge" checked> Merge with existing connections</label>
              <label class="modal-checkbox-line"><input id="importModeReplace" name="importMode" type="radio" value="replace"> Replace existing connections</label>
              <p id="importModeHelp" class="backup-mode-help">Matching connections are updated. New connections are added.</p>
            </div>
          </div>
        </section>
        <div id="importBackupResult" class="backup-result" role="status" aria-live="polite"></div>
        <div id="importBackupValidation" class="backup-validation" role="alert"></div>
      </div>
      <div class="file-properties-actions">
        <button id="importBackupCancelButton" class="secondary" type="button">Close</button>
        <button id="importBackupApplyButton" type="button">Import</button>
      </div>
    </section>
  </div>

  <div id="transferQueueModal" class="transfer-queue-backdrop" role="dialog" aria-modal="true" aria-labelledby="transferQueueTitle" aria-hidden="true">
    <div class="transfer-queue-dialog">
      <div class="transfer-queue-header">
        <div class="transfer-queue-header-text">
          <h2 id="transferQueueTitle" class="transfer-queue-title">Transfer Queue</h2>
          <div class="transfer-queue-subtitle">Monitor current, pending, and completed transfers.</div>
        </div>
      </div>
      <div class="transfer-queue-body">
        <section class="transfer-queue-section" aria-labelledby="transferQueueCurrentTitle">
          <h3 id="transferQueueCurrentTitle" class="transfer-queue-section-title">Current transfer</h3>
          <div id="transferQueueCurrent" class="transfer-queue-items"></div>
        </section>
        <section class="transfer-queue-section" aria-labelledby="transferQueuePendingTitle">
          <h3 id="transferQueuePendingTitle" class="transfer-queue-section-title">Pending transfers</h3>
          <div id="transferQueuePending" class="transfer-queue-items"></div>
        </section>
        <section class="transfer-queue-section transfer-queue-section-scroll" aria-labelledby="transferQueueCompletedTitle">
          <h3 id="transferQueueCompletedTitle" class="transfer-queue-section-title">Completed transfers</h3>
          <div id="transferQueueCompleted" class="transfer-queue-items"></div>
        </section>
      </div>
      <div class="transfer-queue-footer">
        <button id="transferQueueFooterCloseButton" class="secondary" type="button">Close</button>
      </div>
    </div>
  </div>

  <div id="remoteSearchBackdrop" class="file-properties-backdrop remote-search-backdrop" role="dialog" aria-modal="true" aria-labelledby="remoteSearchTitle" aria-hidden="true">
    <section class="file-properties-dialog remote-search-dialog">
      <div class="file-properties-header">
        <h2 id="remoteSearchTitle" class="file-properties-title">Remote Search</h2>
        <div class="file-properties-path">Search remote files by name. SSH/SFTP connections can also search inside files and use Sudo Mode.</div>
      </div>
      <div class="file-properties-body">
        <section class="remote-search-section">
          <div class="remote-command-meta-block">
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Connected to:</span>
              <span id="remoteSearchConnectedTo" class="remote-command-connected-to">-</span>
            </div>
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Run as:</span>
              <span id="remoteSearchRunAs" class="remote-command-run-as">SSH user</span>
            </div>
          </div>
          <div class="remote-search-scope-wrap">
            <div class="remote-search-field remote-search-scope-field">
              <label for="remoteSearchScopePath">Remote path</label>
              <div class="input-with-button remote-search-scope-row">
                <input id="remoteSearchScopePath" type="text" value="/" spellcheck="false" autocomplete="off" />
                <button id="remoteSearchBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Path" data-tooltip="Browse Remote Path">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
            </div>
            <div id="remoteSearchScopePicker" class="remote-search-scope-picker hidden" aria-hidden="true">
              <div class="remote-search-scope-picker-header">
                <div id="remoteSearchScopePickerPath" class="remote-search-scope-picker-path">/</div>
                <div class="remote-search-scope-picker-actions">
                  <button id="remoteSearchScopeSelectButton" class="secondary" type="button">Select This Folder</button>
                  <button id="remoteSearchScopeCancelButton" class="secondary" type="button">Cancel</button>
                </div>
              </div>
              <div id="remoteSearchScopePickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
            </div>
          </div>
          <div class="remote-search-options-grid">
            <label class="modal-checkbox-line"><input id="remoteSearchSubdirectories" class="dialog-checkbox" type="checkbox" checked><span>Include subdirectories</span></label>
            <label class="modal-checkbox-line"><input id="remoteSearchHiddenFiles" class="dialog-checkbox" type="checkbox"><span>Include hidden files</span></label>
            <label class="modal-checkbox-line"><input id="remoteSearchCaseSensitive" class="dialog-checkbox" type="checkbox"><span>Case sensitive</span></label>
            <label id="remoteSearchSudoRow" class="modal-checkbox-line remote-search-ssh-only"><input id="remoteSearchUseSudo" class="dialog-checkbox" type="checkbox"><span>Use Sudo Mode</span><span id="remoteSearchSudoNote" class="remote-command-sudo-note"></span></label>
          </div>
          <div class="remote-search-field">
            <label for="remoteSearchFileName">File name</label>
            <input id="remoteSearchFileName" type="text" value="*" placeholder="*.conf" spellcheck="false" autocomplete="off" />
            <div class="modal-helper-text">Use wildcards: *, ?, [abc]. Separate multiple patterns with commas.</div>
          </div>
          <label id="remoteSearchInsideRow" class="modal-checkbox-line remote-search-ssh-only"><input id="remoteSearchInsideFiles" class="dialog-checkbox" type="checkbox"><span>Search inside files</span></label>
          <div id="remoteSearchTextField" class="remote-search-field remote-search-text-field hidden">
            <label for="remoteSearchTextToFind">Text to Find</label>
            <input id="remoteSearchTextToFind" type="text" spellcheck="false" autocomplete="off" />
          </div>
          <div id="remoteSearchValidation" class="remote-search-validation-line" role="alert" aria-live="polite"></div>
        </section>
        <section class="remote-search-results-section" aria-labelledby="remoteSearchResultsTitle">
          <div class="remote-search-results-header">
            <span id="remoteSearchResultsTitle">Results</span>
            <span id="remoteSearchResultsStatus" class="remote-search-results-status">Idle</span>
          </div>
          <div id="remoteSearchResults" class="remote-search-results"><div class="remote-search-empty">No results.</div></div>
        </section>
      </div>
      <div class="file-properties-actions remote-search-actions">
        <button id="remoteSearchCopyButton" class="secondary" type="button">Copy</button>
        <button id="remoteSearchClearButton" class="secondary" type="button">Clear</button>
        <button id="remoteSearchCloseButton" class="secondary" type="button">Close</button>
        <button id="remoteSearchPrimaryButton" class="remote-search-primary-button" type="button">Search</button>
      </div>
    </section>
  </div>

  <div id="remoteSearchResultContextMenu" class="context-menu remote-search-context-menu" role="menu" aria-label="Search Result Actions">
    <button id="remoteSearchContextOpen" type="button" role="menuitem">View/Edit</button>
    <button id="remoteSearchContextOpenReadOnly" type="button" role="menuitem">View Read-Only</button>
    <div id="remoteSearchContextFileSeparator" class="context-menu-separator" role="separator"></div>
    <button id="remoteSearchContextCopyPath" type="button" role="menuitem">Copy Path</button>
    <button id="remoteSearchContextCopyName" type="button" role="menuitem">Copy Filename</button>
    <div id="remoteSearchContextResultsSeparator" class="context-menu-separator" role="separator"></div>
    <button id="remoteSearchContextCopyResults" type="button" role="menuitem">Copy Results</button>
  </div>

  <div id="confirmDialogBackdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-hidden="true">
    <section class="confirm-dialog">
      <div class="confirm-dialog-header">
        <h2 id="confirmDialogTitle" class="confirm-dialog-title">Confirm action</h2>
        <div id="confirmDialogMessage" class="confirm-dialog-subtitle"></div>
      </div>
      <div id="confirmDialogBody" class="confirm-dialog-body">
        <pre id="confirmDialogDetails" class="confirm-dialog-details" hidden></pre>
      </div>
      <div class="confirm-dialog-actions">
        <button id="confirmDialogCopyButton" class="secondary" type="button" hidden>Copy</button>
        <button id="confirmDialogCancelButton" class="secondary" type="button">Cancel</button>
        <button id="confirmDialogConfirmButton" type="button">Confirm</button>
      </div>
    </section>
  </div>

  <div id="transferConflictBackdrop" class="transfer-conflict-backdrop" role="dialog" aria-modal="true" aria-labelledby="transferConflictTitle" aria-hidden="true">
    <section class="transfer-conflict-dialog" tabindex="-1">
      <div class="transfer-conflict-header">
        <h2 id="transferConflictTitle" class="transfer-conflict-title">Transfer conflict</h2>
        <div id="transferConflictMessage" class="transfer-conflict-subtitle"></div>
      </div>
      <div class="transfer-conflict-body">
        <div class="transfer-conflict-file">
          <span id="transferConflictName" class="transfer-conflict-name"></span>
          <span id="transferConflictPath" class="transfer-conflict-path"></span>
        </div>
        <div class="transfer-conflict-grid">
          <section class="transfer-conflict-card" aria-labelledby="transferConflictSourceTitle">
            <h3 id="transferConflictSourceTitle" class="transfer-conflict-card-title">Source</h3>
            <div class="transfer-conflict-card-body">
              <div id="transferConflictSourceType" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourcePath" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourceSize" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourceModified" class="transfer-conflict-meta"></div>
            </div>
          </section>
          <section class="transfer-conflict-card" aria-labelledby="transferConflictDestinationTitle">
            <h3 id="transferConflictDestinationTitle" class="transfer-conflict-card-title">Destination</h3>
            <div class="transfer-conflict-card-body">
              <div id="transferConflictDestinationType" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationPath" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationSize" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationModified" class="transfer-conflict-meta"></div>
            </div>
          </section>
        </div>
        <p id="transferConflictNote" class="transfer-conflict-note"></p>
      </div>
      <div id="transferConflictActions" class="transfer-conflict-actions"></div>
    </section>
  </div>

  <div id="filePropertiesBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="filePropertiesTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="filePropertiesTitle" class="file-properties-title">File Properties</h2>
        <div id="filePropertiesPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div id="filePropertiesGrid" class="file-properties-grid"></div>
      </div>
      <div class="file-properties-actions">
        <button id="filePropertiesCopyPathButton" type="button" class="secondary">Copy Path</button>
        <button id="filePropertiesCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>

  <div id="checksumsBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="checksumsTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="checksumsTitle" class="file-properties-title">Checksums</h2>
        <div id="checksumsPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div id="checksumsGrid" class="file-properties-grid"></div>
      </div>
      <div class="file-properties-actions">
        <button id="checksumsCopySha256Button" type="button" class="secondary">Copy SHA-256</button>
        <button id="checksumsCopyMd5Button" type="button" class="secondary">Copy MD5</button>
        <button id="checksumsCopyAllButton" type="button" class="secondary">Copy All</button>
        <button id="checksumsCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>


  <div id="ownerGroupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="ownerGroupTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="ownerGroupTitle" class="file-properties-title">Change Owner/Group</h2>
        <div id="ownerGroupPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div class="owner-group-form">
          <div class="owner-group-input-grid">
            <div>
              <label for="ownerGroupOwnerInput">Owner</label>
              <div class="owner-group-combo" data-owner-group-combo="owner">
                <input id="ownerGroupOwnerInput" type="text" autocomplete="off" spellcheck="false" placeholder="owner" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ownerGroupOwnerSuggestions">
                <div id="ownerGroupOwnerSuggestions" class="owner-group-suggestions" role="listbox" aria-label="Owner suggestions"></div>
              </div>
            </div>
            <div>
              <label for="ownerGroupGroupInput">Group</label>
              <div class="owner-group-combo" data-owner-group-combo="group">
                <input id="ownerGroupGroupInput" type="text" autocomplete="off" spellcheck="false" placeholder="group" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ownerGroupGroupSuggestions">
                <div id="ownerGroupGroupSuggestions" class="owner-group-suggestions" role="listbox" aria-label="Group suggestions"></div>
              </div>
            </div>
          </div>
          <div id="ownerGroupHelperBlock" class="modal-checkbox-block">
            <label id="ownerGroupRecursiveRow" class="modal-checkbox-line">
              <input id="ownerGroupRecursiveInput" class="dialog-checkbox" type="checkbox">
              <span>Apply recursively to selected directories</span>
            </label>
            <div id="ownerGroupNote" class="modal-helper-text modal-checkbox-helper"></div>
            <div class="modal-helper-text modal-checkbox-helper">May fail without enough permissions. Enable Sudo Mode if needed.</div>
          </div>
          <div id="ownerGroupValidation" class="owner-group-validation" role="alert"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="ownerGroupCancelButton" class="secondary" type="button">Cancel</button>
        <button id="ownerGroupApplyButton" type="button">Apply</button>
      </div>
    </section>
  </div>

  <div id="remoteCommandBackdrop" class="remote-command-backdrop" role="dialog" aria-modal="true" aria-labelledby="remoteCommandTitle" aria-hidden="true">
    <section class="remote-command-dialog">
      <div class="remote-command-header">
        <h2 id="remoteCommandTitle" class="remote-command-title">Run Remote Command</h2>
        <div class="remote-command-subtitle">Run non-interactive remote commands with streaming output.</div>
      </div>
      <div class="remote-command-body">
        <div class="remote-command-main">
          <div class="remote-command-field-grid">
            <div class="remote-command-meta-block">
              <div class="remote-command-meta">
                <span class="remote-command-meta-label">Connected to:</span>
                <span id="remoteCommandConnectedTo" class="remote-command-connected-to">-</span>
              </div>
              <div class="remote-command-meta">
                <span class="remote-command-meta-label">Run as:</span>
                <span id="remoteCommandRunAs" class="remote-command-run-as">SSH user</span>
              </div>
            </div>
            <div class="remote-command-working-directory-wrap">
              <label class="remote-command-section-title" for="remoteCommandWorkingDirectory">Remote path</label>
              <div class="input-with-button remote-command-working-directory-row">
                <input id="remoteCommandWorkingDirectory" type="text" value="/" spellcheck="false" autocomplete="off" />
                <button id="remoteCommandBrowseWorkingDirectoryButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Path" data-tooltip="Browse Remote Path">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
              <div id="remoteCommandWorkingDirectoryPicker" class="remote-search-scope-picker hidden" aria-hidden="true">
                <div class="remote-search-scope-picker-header">
                  <div id="remoteCommandWorkingDirectoryPickerPath" class="remote-search-scope-picker-path">/</div>
                  <div class="remote-search-scope-picker-actions">
                    <button id="remoteCommandWorkingDirectorySelectButton" class="secondary" type="button">Select This Folder</button>
                    <button id="remoteCommandWorkingDirectoryCancelButton" class="secondary" type="button">Cancel</button>
                  </div>
                </div>
                <div id="remoteCommandWorkingDirectoryPickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
              </div>
            </div>
            <div class="remote-command-field remote-command-command-field">
              <label for="remoteCommandInput">Command</label>
              <div class="remote-command-input-row">
                <textarea id="remoteCommandInput" spellcheck="false" autocomplete="off"></textarea>
              </div>
            </div>
            <label id="remoteCommandSudoRow" class="remote-command-sudo-row">
              <input id="remoteCommandUseSudo" class="dialog-checkbox" type="checkbox">
              <span>Use Sudo Mode</span>
              <span id="remoteCommandSudoNote" class="remote-command-sudo-note"></span>
            </label>
            <div class="remote-command-run-row">
              <button id="remoteCommandRunButton" type="button">Run</button>
            </div>
          </div>
          <div class="remote-command-output-section">
            <div class="remote-command-output-header">
              <div class="remote-command-output-title">Output</div>
              <div id="remoteCommandOutputNotice" class="remote-command-output-notice"></div>
            </div>
            <div id="remoteCommandOutputWrap" class="remote-command-output-wrap" tabindex="0" aria-label="Command Output">
              <pre id="remoteCommandOutput" class="remote-command-output"></pre>
            </div>
            <div id="remoteCommandStatus" class="remote-command-status"></div>
          </div>
        </div>
        <aside class="remote-command-side" aria-label="Saved Commands and Command History">
          <section class="remote-command-side-section" aria-labelledby="remoteCommandSavedTitle">
            <div class="remote-command-side-header">
              <h3 id="remoteCommandSavedTitle" class="remote-command-side-title">Saved Commands</h3>
              <button id="remoteCommandSaveCurrentButton" class="secondary remote-command-compact-button" type="button">+ Save current</button>
            </div>
            <div id="remoteCommandSavedList" class="remote-command-side-list"></div>
          </section>
          <section class="remote-command-side-section" aria-labelledby="remoteCommandHistoryTitle">
            <div class="remote-command-side-header">
              <h3 id="remoteCommandHistoryTitle" class="remote-command-side-title">Command History</h3>
            </div>
            <div id="remoteCommandHistoryList" class="remote-command-side-list"></div>
          </section>
        </aside>
      </div>
      <div id="remoteCommandCloseWarning" class="remote-command-close-warning" role="alert">
        <div class="remote-command-close-warning-text">Command is still running. Closing this window will keep it running.</div>
        <div class="remote-command-close-warning-actions">
          <button id="remoteCommandKeepRunningButton" class="secondary" type="button">Return to command</button>
          <button id="remoteCommandStopAndCloseButton" type="button">Stop command</button>
        </div>
      </div>
      <div id="remoteCommandStopWarning" class="remote-command-stop-warning" role="alert">
        <div class="remote-command-close-warning-text">Command is still stopping. Force kill it?</div>
        <div class="remote-command-stop-warning-actions">
          <button id="remoteCommandKeepStoppingButton" class="secondary" type="button">Keep waiting</button>
          <button id="remoteCommandForceKillButton" type="button">Force kill</button>
        </div>
      </div>
      <div class="remote-command-actions">
        <button id="remoteCommandCopyButton" class="secondary" type="button">Copy</button>
        <button id="remoteCommandClearButton" class="secondary" type="button">Clear</button>
        <button id="remoteCommandCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>

  <div id="entryContextMenu" class="context-menu" role="menu" aria-label="Entry Actions">
  <button id="contextOpen" type="button" role="menuitem">View/Edit</button>
  <button id="contextOpenReadOnly" type="button" role="menuitem">View Read-Only</button>
  <button id="contextCompare" type="button" role="menuitem">Compare Selected</button>
  <div id="contextOpenSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextMakeCopy" type="button" role="menuitem">Make a Copy...</button>
  <button id="contextRename" type="button" role="menuitem">Rename...</button>
  <div id="contextCopySeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCopyPath" type="button" role="menuitem">Copy Path</button>
  <button id="contextCopyName" type="button" role="menuitem">Copy Filename</button>
  <div id="contextItemSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDownload" type="button" role="menuitem">Download...</button>
  <button id="contextUploadEntry" type="button" role="menuitem">Upload...</button>
  <div id="contextTransferSeparator" class="context-menu-separator" role="separator"></div>
  <div id="contextCompressSubmenu" class="context-submenu" role="none">
    <button id="contextCompressTrigger" class="context-submenu-trigger" type="button" role="menuitem" aria-haspopup="true">Compress to Archive</button>
    <div class="context-submenu-content" role="menu" aria-label="Archive Formats">
      <button id="contextCompressTarGz" type="button" role="menuitem" data-archive-format="tar.gz">tar.gz...</button>
      <button id="contextCompressTarBz2" type="button" role="menuitem" data-archive-format="tar.bz2">tar.bz2...</button>
      <button id="contextCompressTarXz" type="button" role="menuitem" data-archive-format="tar.xz">tar.xz...</button>
      <button id="contextCompressTarZ" type="button" role="menuitem" data-archive-format="tar.Z">tar.Z...</button>
    </div>
  </div>
  <button id="contextCalculateChecksums" type="button" role="menuitem">Calculate Checksums</button>
  <button id="contextFileProperties" type="button" role="menuitem">File Properties</button>
  <button id="contextSetPermissions" type="button" role="menuitem">Set Permissions...</button>
  <button id="contextChangeOwnerGroup" type="button" role="menuitem">Change Owner/Group...</button>
  <div id="contextRefreshSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCreateFile" type="button" role="menuitem">Create New File...</button>
  <button id="contextCreateDirectory" type="button" role="menuitem">Create New Directory...</button>
  <button id="contextUpload" type="button" role="menuitem">Upload...</button>
  <div id="contextEmptyCopySeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCopyCurrentPath" type="button" role="menuitem">Copy Current Path</button>
  <div id="contextEmptyRefreshSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextRefresh" type="button" role="menuitem">Refresh</button>
  <button id="contextOpenLogViewer" type="button" role="menuitem">Open in Log Viewer</button>
  <button id="contextRunRemoteCommand" type="button" role="menuitem">Run Remote Command...</button>
  <button id="contextOpenSshTerminal" type="button" role="menuitem">Open SSH Terminal</button>
  <div id="contextDeleteSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDelete" type="button" role="menuitem">Delete</button>
  </div>


  <div id="textEditContextMenu" class="context-menu text-edit-context-menu" role="menu" aria-label="Text Edit Actions">
    <button id="textEditContextUndo" type="button" role="menuitem">Undo</button>
    <button id="textEditContextRedo" type="button" role="menuitem">Redo</button>
    <div class="context-menu-separator" role="separator"></div>
    <button id="textEditContextCut" type="button" role="menuitem">Cut</button>
    <button id="textEditContextCopy" type="button" role="menuitem">Copy</button>
    <button id="textEditContextPaste" type="button" role="menuitem">Paste</button>
    <div class="context-menu-separator" role="separator"></div>
    <button id="textEditContextSelectAll" type="button" role="menuitem">Select All</button>
  </div>


  <div id="permissionBackdrop" class="permission-backdrop" aria-hidden="true">
  <section class="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permissionDialogTitle">
    <div class="permission-dialog-header">
      <h2 id="permissionDialogTitle" class="permission-dialog-title">Set Permissions</h2>
      <div id="permissionDialogPath" class="permission-dialog-path"></div>
    </div>
    <div class="permission-dialog-body">
      <section class="permission-section">
        <p class="permission-section-title">Basic permissions</p>
        <table class="permission-table" aria-label="Basic permissions">
          <thead>
            <tr><th></th><th>Read</th><th>Write</th><th>Execute</th></tr>
          </thead>
          <tbody>
            <tr><td>Owner</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerRead" aria-label="Owner read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerWrite" aria-label="Owner write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerExecute" aria-label="Owner execute"></td></tr>
            <tr><td>Group</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupRead" aria-label="Group read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupWrite" aria-label="Group write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupExecute" aria-label="Group execute"></td></tr>
            <tr><td>Others</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersRead" aria-label="Others read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersWrite" aria-label="Others write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersExecute" aria-label="Others execute"></td></tr>
          </tbody>
        </table>
      </section>
      <section class="permission-section">
        <p class="permission-section-title">Special permissions</p>
        <div class="permission-special-list">
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="setuid"> <span id="permissionSetuidLabel">Run as owner / setuid</span></label>
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="setgid"> <span id="permissionSetgidLabel">Run as group / setgid</span></label>
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="sticky"> <span id="permissionStickyLabel">Sticky bit</span></label>
        </div>
      </section>
      <section class="permission-section">
        <div class="permission-mode-row">
          <label for="permissionModeInput">Octal</label>
          <input id="permissionModeInput" type="text" maxlength="4" inputmode="numeric" autocomplete="off">
          <span id="permissionCurrentText" class="permission-current permission-preview-stack" aria-live="polite"></span>
        </div>
        <div id="permissionHelperBlock" class="permission-checkbox-block modal-checkbox-block">
          <label id="permissionRecursiveRow" class="modal-checkbox-line">
            <input id="permissionRecursiveInput" class="dialog-checkbox" type="checkbox">
            <span>Apply recursively to selected directories</span>
          </label>
          <div id="permissionNote" class="modal-helper-text modal-checkbox-helper"></div>
          <div class="modal-helper-text modal-checkbox-helper">May fail without enough permissions. Enable Sudo Mode if needed.</div>
        </div>
        <div id="permissionValidation" class="permission-validation" role="alert"></div>
      </section>
    </div>
    <div class="permission-dialog-actions">
      <button id="permissionCancelButton" class="secondary" type="button">Cancel</button>
      <button id="permissionApplyButton" type="button">Apply</button>
    </div>
  </section>
  </div>

`;
}
