// ==UserScript==
// @name         GUC CMS Local Dev Loader
// @namespace    https://cms.guc.edu.eg/
// @version      1.4.0
// @description  Automatically loads and runs the local guc_cms.user.js from disk on every page reload.
// @author       Antigravity
// @match        https://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @match        http://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @icon         https://cms.guc.edu.eg/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @require      file:///home/yassin/Projects/Tamper%20monky%20CMS%20Script/guc_cms.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @connect      *
// @connect      cms.guc.edu.eg
// @run-at       document-idle
// ==/UserScript==
