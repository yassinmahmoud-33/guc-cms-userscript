// ==UserScript==
// @name         GUC CMS Content Renamer & Batch Downloader
// @namespace    https://cms.guc.edu.eg/
// @version      1.3.0
// @description  Renames GUC CMS file downloads to match content titles and adds 1-click batch ZIP downloads per week beside the week heading.
// @author       Antigravity
// @match        https://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @match        http://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @icon         https://cms.guc.edu.eg/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @connect      *
// @connect      cms.guc.edu.eg
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION & SELECTORS
    // =========================================================================
    const CONFIG = {
        // Individual content item cards
        ITEM_CARD_SELECTOR: 'div.card.mb-4',

        // Download link selector inside each card
        DOWNLOAD_LINK_SELECTOR: 'a#download.contentbtn, a.contentbtn[href*="/Uploads/"]',

        // Title element selector inside each card
        TITLE_STRONG_SELECTOR: 'div[id^="content"] strong',
        TITLE_CONTAINER_SELECTOR: 'div[id^="content"]',

        // VoD "Watch Video" button selector
        VOD_BUTTON_SELECTOR: 'input.vodbutton, .vodbutton',

        // Week heading selector
        WEEK_HEADING_SELECTOR: 'h2.text-big, h1.text-big, h2, h3',

        // Maximum safe filename character length (excluding extension)
        MAX_FILENAME_LENGTH: 150,

        // Whether to include VoD (MP4) files in the weekly ZIP archive
        INCLUDE_VOD_IN_ZIP: true,

        // Concurrent download limit for batch fetching
        CONCURRENCY_LIMIT: 3,

        // Request timeout in milliseconds (25 seconds)
        REQUEST_TIMEOUT_MS: 25000
    };

    // =========================================================================
    // STYLES
    // =========================================================================
    const STYLES = `
        /* Align week heading container nicely with the zip button */
        .guc-week-heading-wrapper {
            display: inline-flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
        }

        /* Batch Zip Button placed beside Week heading */
        .guc-zip-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 12px;
            padding: 5px 12px;
            font-size: 13px;
            font-weight: 600;
            line-height: 1.4;
            color: #ffffff !important;
            background: linear-gradient(135deg, #0d6efd, #0b5ed7);
            border: 1px solid #0a58ca;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(13, 110, 253, 0.2);
            transition: all 0.2s ease-in-out;
            text-decoration: none !important;
            vertical-align: middle;
        }
        .guc-zip-btn:hover {
            background: linear-gradient(135deg, #0b5ed7, #0a58ca);
            box-shadow: 0 4px 8px rgba(13, 110, 253, 0.3);
            transform: translateY(-1px);
        }
        .guc-zip-btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(13, 110, 253, 0.2);
        }
        .guc-zip-btn:disabled, .guc-zip-btn.busy {
            background: #6c757d !important;
            border-color: #5c636a !important;
            cursor: not-allowed !important;
            transform: none !important;
            box-shadow: none !important;
        }

        /* Badge inside Zip Button */
        .guc-zip-count-badge {
            background: rgba(255, 255, 255, 0.28);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 700;
        }

        /* Dedicated VoD Download Button */
        .guc-vod-dl-btn {
            margin-left: 6px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 500;
            color: #ffffff !important;
            background-color: #198754;
            border: 1px solid #157347;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s ease-in-out;
            display: inline-block;
            text-decoration: none !important;
        }
        .guc-vod-dl-btn:hover {
            background-color: #157347;
        }

        /* Global Floating Progress Toast */
        .guc-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            max-width: 380px;
            background: #ffffff;
            color: #212529;
            border-radius: 8px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
            padding: 14px 18px;
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            font-size: 13px;
            border-left: 5px solid #0d6efd;
            transition: all 0.3s ease;
        }
        .guc-toast-title {
            font-weight: 700;
            font-size: 14px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .guc-toast-body {
            color: #495057;
            word-break: break-word;
            line-height: 1.4;
        }
        .guc-toast-close {
            cursor: pointer;
            background: none;
            border: none;
            font-size: 16px;
            color: #adb5bd;
        }
        .guc-toast-close:hover {
            color: #495057;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(STYLES);
    } else {
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);
    }

    // =========================================================================
    // TOAST NOTIFICATIONS
    // =========================================================================

    let activeToast = null;

    function showToast(title, message, isError = false, autoCloseMs = 0) {
        if (!activeToast) {
            activeToast = document.createElement('div');
            activeToast.className = 'guc-toast';
            document.body.appendChild(activeToast);
        }

        activeToast.style.borderLeftColor = isError ? '#dc3545' : '#0d6efd';
        activeToast.innerHTML = `
            <div class="guc-toast-title">
                <span>${isError ? '⚠️' : '📦'} ${title}</span>
                <button class="guc-toast-close" title="Close">✕</button>
            </div>
            <div class="guc-toast-body">${message}</div>
        `;

        activeToast.querySelector('.guc-toast-close').onclick = () => {
            if (activeToast && activeToast.parentNode) {
                activeToast.parentNode.removeChild(activeToast);
                activeToast = null;
            }
        };

        if (autoCloseMs > 0) {
            setTimeout(() => {
                if (activeToast && activeToast.parentNode) {
                    activeToast.parentNode.removeChild(activeToast);
                    activeToast = null;
                }
            }, autoCloseMs);
        }
    }

    // =========================================================================
    // FILENAME & DOM EXTRACTION UTILITIES
    // =========================================================================

    function sanitizeFilename(name, maxLen = CONFIG.MAX_FILENAME_LENGTH) {
        if (!name) return 'Untitled';

        let clean = name
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        clean = clean.replace(/[. ]+$/, '');

        if (clean.length > maxLen) {
            clean = clean.substring(0, maxLen).trim().replace(/[. ]+$/, '');
        }

        return clean || 'Untitled';
    }

    function extractExtensionFromUrl(url) {
        if (!url) return '.pdf';
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
            const dotIndex = lastSegment.lastIndexOf('.');
            if (dotIndex !== -1 && dotIndex < lastSegment.length - 1) {
                const ext = lastSegment.substring(dotIndex).toLowerCase();
                if (/^\.[a-z0-9]{1,6}$/i.test(ext)) {
                    return ext;
                }
            }
        } catch (e) {
            console.warn('[GUC CMS] Extension parse warning:', url, e);
        }
        return '.pdf';
    }

    function extractItemInfo(card) {
        if (!card) return null;

        const downloadLink = card.querySelector(CONFIG.DOWNLOAD_LINK_SELECTOR);
        if (!downloadLink) return null;

        const rawHref = downloadLink.getAttribute('href') || downloadLink.href || '';
        if (!rawHref || rawHref.startsWith('javascript:')) return null;

        const absoluteUrl = new URL(rawHref, window.location.origin).href;
        const contentId = downloadLink.getAttribute('data-contentid') || '';
        const ext = extractExtensionFromUrl(rawHref);

        // Title extraction
        const titleStrong = card.querySelector(CONFIG.TITLE_STRONG_SELECTOR);
        const titleContainer = card.querySelector(CONFIG.TITLE_CONTAINER_SELECTOR);

        let mainTitle = '';
        let typeSuffix = '';

        if (titleStrong && titleStrong.textContent.trim()) {
            mainTitle = titleStrong.textContent.trim();

            if (titleContainer) {
                const fullContainerText = titleContainer.textContent.trim();
                const strongText = titleStrong.textContent.trim();
                const afterStrong = fullContainerText.replace(strongText, '').trim();
                if (afterStrong && /^\([^)]+\)/.test(afterStrong)) {
                    typeSuffix = ' ' + afterStrong.match(/^\([^)]+\)/)[0];
                }
            }
        } else if (titleContainer && titleContainer.textContent.trim()) {
            mainTitle = titleContainer.textContent.trim();
        } else {
            mainTitle = `Content_${contentId || Date.now()}`;
        }

        const linkHidden = (downloadLink.style.display === 'none' || downloadLink.hidden || downloadLink.getAttribute('style')?.includes('display:none'));
        const vodButton = card.querySelector(CONFIG.VOD_BUTTON_SELECTOR);
        const vodButtonVisible = vodButton && vodButton.style.display !== 'none' && !vodButton.getAttribute('style')?.includes('display:none');

        const isVod = ext === '.mp4' || ext === '.mkv' || typeSuffix.toLowerCase().includes('vod') || (linkHidden && vodButtonVisible);

        const baseTitle = sanitizeFilename(mainTitle + typeSuffix);

        return {
            cardElement: card,
            downloadLinkElement: downloadLink,
            contentId: contentId,
            url: absoluteUrl,
            rawHref: rawHref,
            baseTitle: baseTitle,
            extension: ext,
            isVod: isVod,
            linkHidden: linkHidden
        };
    }

    function deduplicateFilenames(items) {
        const titleCounts = new Map();

        return items.map(item => {
            const key = `${item.baseTitle.toLowerCase()}${item.extension.toLowerCase()}`;
            const count = (titleCounts.get(key) || 0) + 1;
            titleCounts.set(key, count);

            let finalName = '';
            if (count === 1) {
                finalName = `${item.baseTitle}${item.extension}`;
            } else {
                finalName = `${item.baseTitle} (${count - 1})${item.extension}`;
            }

            return {
                ...item,
                uniqueFilename: finalName
            };
        });
    }

    // =========================================================================
    // DIRECT BINARY FETCH (Fast same-origin fetch + fallback)
    // =========================================================================

    /**
     * Downloads file as raw ArrayBuffer.
     * Uses native browser fetch with cookies (same origin) first, falls back to GM_xmlhttpRequest.
     */
    async function fetchFileArrayBuffer(url) {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), CONFIG.REQUEST_TIMEOUT_MS)
        );

        const fetchPromise = (async () => {
            try {
                // Same-origin fetch includes session cookies natively
                const response = await window.fetch(url, {
                    method: 'GET',
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.arrayBuffer();
            } catch (fetchErr) {
                console.warn('[GUC CMS] Native fetch failed, trying GM_xmlhttpRequest:', fetchErr);

                // Fallback to GM_xmlhttpRequest if native fetch had an issue
                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    return new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: url,
                            responseType: 'arraybuffer',
                            timeout: CONFIG.REQUEST_TIMEOUT_MS,
                            onload: (res) => {
                                if (res.status >= 200 && res.status < 300) {
                                    resolve(res.response);
                                } else {
                                    reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
                                }
                            },
                            onerror: (err) => reject(err || new Error('GM_xmlhttpRequest network error')),
                            ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout'))
                        });
                    });
                }
                throw fetchErr;
            }
        })();

        return Promise.race([fetchPromise, timeoutPromise]);
    }

    /**
     * Saves a Blob to user's disk with standard anchor click and direct link fallback.
     */
    function triggerBlobDownload(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 30000);
    }

    // =========================================================================
    // FEATURE 1: ENHANCE & RENAME INDIVIDUAL DOWNLOAD LINKS
    // =========================================================================

    async function triggerSingleDownload(item, buttonEl) {
        const originalText = buttonEl ? (buttonEl.innerText || buttonEl.value) : '';
        if (buttonEl) {
            buttonEl.innerText = '⏳ Downloading...';
            buttonEl.disabled = true;
        }

        try {
            const buffer = await fetchFileArrayBuffer(item.url);
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const filename = item.uniqueFilename || `${item.baseTitle}${item.extension}`;

            triggerBlobDownload(blob, filename);

            if (buttonEl) {
                buttonEl.innerText = '✓ Downloaded';
                setTimeout(() => {
                    buttonEl.innerText = originalText;
                    buttonEl.disabled = false;
                }, 2000);
            }
        } catch (err) {
            console.error('[GUC CMS] Download error:', err);
            if (buttonEl) {
                buttonEl.innerText = '❌ Failed';
                setTimeout(() => {
                    buttonEl.innerText = originalText;
                    buttonEl.disabled = false;
                }, 3000);
            }
            window.location.href = item.url;
        }
    }

    function enhanceSingleDownloadLinks() {
        const cards = Array.from(document.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR));
        if (!cards.length) return;

        const parsedItems = cards.map(c => extractItemInfo(c)).filter(Boolean);
        const deduplicatedItems = deduplicateFilenames(parsedItems);

        deduplicatedItems.forEach(item => {
            const link = item.downloadLinkElement;
            if (!link) return;

            link.setAttribute('download', item.uniqueFilename);
            link.setAttribute('title', `Save as: ${item.uniqueFilename}`);

            if (!link.hasAttribute('data-guc-renamer-bound')) {
                link.setAttribute('data-guc-renamer-bound', 'true');

                link.addEventListener('click', function (e) {
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerSingleDownload(item, link);
                    }
                }, true);
            }

            if (item.linkHidden && item.isVod) {
                const parentDiv = link.parentElement;
                if (parentDiv && !parentDiv.querySelector('.guc-vod-dl-btn')) {
                    const vodDlBtn = document.createElement('button');
                    vodDlBtn.type = 'button';
                    vodDlBtn.className = 'guc-vod-dl-btn';
                    vodDlBtn.innerHTML = `📥 Download Video (${item.extension.toUpperCase().replace('.', '')})`;
                    vodDlBtn.setAttribute('title', `Download ${item.uniqueFilename}`);

                    vodDlBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerSingleDownload(item, vodDlBtn);
                    });

                    parentDiv.appendChild(vodDlBtn);
                }
            }
        });
    }

    // =========================================================================
    // FEATURE 2: BATCH DOWNLOAD WEEK / SECTION AS ZIP
    // =========================================================================

    async function executeBatchZip(sectionTitle, items, statusBtn) {
        if (!items || items.length === 0) {
            alert('No downloadable files found in this section.');
            return;
        }

        // Ensure JSZip is available
        const JSZipLib = (typeof JSZip !== 'undefined') ? JSZip : window.JSZip;
        if (!JSZipLib) {
            showToast('JSZip Missing', 'JSZip library failed to load. Please refresh the page.', true);
            return;
        }

        const originalBtnHtml = statusBtn.innerHTML;
        statusBtn.classList.add('busy');
        statusBtn.disabled = true;

        const updateStatus = (btnText, toastText) => {
            statusBtn.innerHTML = btnText;
            if (toastText) showToast(sectionTitle, toastText);
        };

        const zip = new JSZipLib();
        const deduplicated = deduplicateFilenames(items);
        const total = deduplicated.length;
        let completed = 0;
        let failedCount = 0;

        console.log(`[GUC CMS] Starting batch ZIP for "${sectionTitle}" (${total} files)...`);
        updateStatus(`⏳ Starting (0/${total})...`, `Starting download of ${total} files...`);

        // Concurrent downloader
        let currentIndex = 0;
        async function worker() {
            while (currentIndex < deduplicated.length) {
                const itemIndex = currentIndex++;
                const item = deduplicated[itemIndex];

                updateStatus(
                    `⏳ (${completed + 1}/${total}) ${item.uniqueFilename.substring(0, 15)}...`,
                    `Downloading (${completed + 1}/${total}): <strong>${item.uniqueFilename}</strong>`
                );

                try {
                    console.log(`[GUC CMS] Fetching: ${item.uniqueFilename} (${item.url})`);
                    const arrayBuffer = await fetchFileArrayBuffer(item.url);

                    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                        throw new Error('Received empty file buffer');
                    }

                    // Directly add buffer into zip archive
                    zip.file(item.uniqueFilename, arrayBuffer, { binary: true });
                    completed++;
                    console.log(`[GUC CMS] Successfully buffered (${completed}/${total}): ${item.uniqueFilename}`);
                } catch (err) {
                    console.error(`[GUC CMS] Failed to fetch "${item.uniqueFilename}":`, err);
                    failedCount++;
                }
            }
        }

        const workers = [];
        const poolSize = Math.min(CONFIG.CONCURRENCY_LIMIT, total);
        for (let i = 0; i < poolSize; i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        if (completed === 0) {
            showToast('Download Failed', `Could not download any files for ${sectionTitle}. Please check your connection.`, true);
            statusBtn.innerHTML = originalBtnHtml;
            statusBtn.classList.remove('busy');
            statusBtn.disabled = false;
            return;
        }

        // Packaging stage
        updateStatus(`📦 Packaging ZIP (${completed} files)...`, `Packaging ${completed} files into ZIP archive...`);
        console.log(`[GUC CMS] Generating ZIP blob for ${completed} items...`);

        try {
            const zipBlob = await zip.generateAsync(
                { type: 'blob', compression: 'STORE' },
                (metadata) => {
                    const pct = Math.round(metadata.percent);
                    updateStatus(`📦 Packaging (${pct}%)...`, `Compressing: ${pct}%`);
                }
            );

            console.log(`[GUC CMS] ZIP blob ready: ${(zipBlob.size / (1024 * 1024)).toFixed(2)} MB`);

            const cleanZipName = `${sanitizeFilename(sectionTitle)} - GUC CMS.zip`;
            triggerBlobDownload(zipBlob, cleanZipName);

            const resultMsg = failedCount > 0
                ? `Completed with ${failedCount} skipped file(s). Download started!`
                : `Successfully packaged ${completed} files! Download started.`;

            updateStatus(failedCount > 0 ? `⚠️ Done (${failedCount} skipped)` : `✅ Complete!`, resultMsg);
            showToast('Download Ready', resultMsg, false, 6000);
        } catch (zipErr) {
            console.error('[GUC CMS] Error generating ZIP:', zipErr);
            showToast('ZIP Error', `Failed to generate ZIP archive: ${zipErr.message}`, true);
            updateStatus('❌ ZIP Error');
        } finally {
            setTimeout(() => {
                statusBtn.innerHTML = originalBtnHtml;
                statusBtn.classList.remove('busy');
                statusBtn.disabled = false;
            }, 4000);
        }
    }

    /**
     * Injects ZIP download button beside each Week heading.
     */
    function injectZipButtons() {
        const headings = Array.from(document.querySelectorAll(CONFIG.WEEK_HEADING_SELECTOR)).filter(h => {
            const text = (h.textContent || '').trim();
            return /^week[:\s]/i.test(text) && !h.closest('.card.mb-4');
        });

        headings.forEach((heading, idx) => {
            if (heading.querySelector('.guc-zip-btn') || heading.getAttribute('data-guc-zip-bound')) return;

            const rawTitle = heading.textContent.replace(/Download.*Zip/gi, '').trim() || `Week ${idx + 1}`;
            const weekContainer = heading.closest('.card:not(.mb-4), .panel, .tab-pane') || heading.closest('.row')?.parentElement || document.body;

            let collectedCards = [];

            if (weekContainer !== document.body) {
                const containerHeadings = weekContainer.querySelectorAll('h2.text-big, h1.text-big');
                if (containerHeadings.length <= 1) {
                    collectedCards = Array.from(weekContainer.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR));
                }
            }

            if (collectedCards.length === 0) {
                let current = heading.closest('.row') || heading;
                let next = current.nextElementSibling;
                while (next) {
                    if (next.querySelector('h2.text-big') || (next.matches('h2') && /^week[:\s]/i.test(next.textContent))) {
                        break;
                    }
                    if (next.matches(CONFIG.ITEM_CARD_SELECTOR)) {
                        collectedCards.push(next);
                    } else {
                        const nested = next.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR);
                        nested.forEach(c => collectedCards.push(c));
                    }
                    next = next.nextElementSibling;
                }
            }

            if (collectedCards.length > 0) {
                heading.setAttribute('data-guc-zip-bound', 'true');
                heading.classList.add('guc-week-heading-wrapper');

                const items = collectedCards.map(c => extractItemInfo(c)).filter(Boolean);
                const filteredItems = CONFIG.INCLUDE_VOD_IN_ZIP ? items : items.filter(i => !i.isVod);

                const zipBtn = createZipButton(rawTitle, filteredItems);
                heading.appendChild(zipBtn);
            }
        });
    }

    function createZipButton(title, items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'guc-zip-btn';
        btn.innerHTML = `📦 Download Week as ZIP <span class="guc-zip-count-badge">${items.length}</span>`;
        btn.title = `Download all ${items.length} files in this section as a ZIP archive`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeBatchZip(title, items, btn);
        });

        return btn;
    }

    // =========================================================================
    // INITIALIZATION & MUTATION OBSERVER
    // =========================================================================

    function runAll() {
        enhanceSingleDownloadLinks();
        injectZipButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runAll);
    } else {
        runAll();
    }

    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const mut of mutations) {
            if (mut.addedNodes.length > 0) {
                shouldUpdate = true;
                break;
            }
        }

        if (shouldUpdate) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                runAll();
            }, 300);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[GUC CMS] Content Renamer & Batch Downloader v1.3.0 initialized.');
})();