// ==UserScript==
// @name         Cat in a Flat UK Monitor
// @namespace    http://tampermonkey.net/
// @version      7.9.1
// @description  修复了日志系统自我引用的递归错误。
// @author       Gemini & User
// @match        *://catinaflat.co.uk/*
// @match        *://*.catinaflat.co.uk/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk
// @grant        GM_notification
// @grant        GM_log
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_info
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================================
    // == [1] 配置中心 (Configuration Center)
    // =================================================================================
    const DEFAULTS = {
        minRefreshMinutes: 7,
        maxRefreshMinutes: 10,
        googleScriptUrl: "https://script.google.com/macros/s/AKfycbxgLvGctjIGj-Vmx6zLquxc-5fsBu9ik4n_j6XNEFqI_BvfhggrpY7f668OssWbTF_D/exec",
        enableEmail: true,
        enableSound: true,
        enablePopup: true,
        enableTitleFlash: true,
        pauseWhileTyping: true,
        idleAlertMinutes: 30,
    };

    let config = {};
    const SCRIPT_LOGS_MAX_LINES = 200;
    const GM_STORAGE_LOG_KEY = 'catScriptPersistentLogs';
    let scriptLogs = [];
    const QUICK_LOG_DISPLAY_COUNT = 5;

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function updateScriptLogDisplay() {
        const logContent = document.getElementById('ciaf-script-log-content');
        if (logContent) {
            logContent.textContent = scriptLogs.join('\n');
            logContent.scrollTop = logContent.scrollHeight;
        }

        const quickLogsDiv = document.getElementById('ciaf-quick-logs-display'); // <- Corrected ID
        if (quickLogsDiv) {
            const recentLogsDisplay = scriptLogs.slice(Math.max(0, scriptLogs.length - QUICK_LOG_DISPLAY_COUNT))
                                              .map(log => escapeHtml(log))
                                              .join('<br>');
            quickLogsDiv.innerHTML = recentLogsDisplay;
        }
    }

    const originalGmLog = GM_log;
    GM_log = function(...args) {
        originalGmLog.apply(this, args);

        const timestamp = new Date().toLocaleTimeString();
        let logMessage = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg, (key, value) => {
                        // 防止因为logs数组导致循环引用
                        if (key === 'logs' && Array.isArray(value)) {
                            return `[...${value.length} log entries...]`;
                        }
                        return value;
                    }, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        scriptLogs.push(`[${timestamp}] ${logMessage}`);

        if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) {
            scriptLogs.shift();
        }
        updateScriptLogDisplay();
    };

    function loadConfig() {
        const savedConfig = GM_getValue('catScriptConfig_v6', {});
        config = { ...DEFAULTS, ...savedConfig };
        GM_log("配置已加载: ", config);
    }

    function saveConfig() {
        GM_setValue('catScriptConfig_v6', config);
        alert("设置已保存！部分设置（如刷新时间）将在下次刷新或手动重置计时器后生效。");
        GM_log("配置已保存: ", config);
    }

    function resetConfig() {
        if (confirm("您确定要将所有设置重置为默认值吗？")) {
            config = { ...DEFAULTS };
            saveConfig();
            location.reload();
        }
    }

    // =================================================================================
    // == [2] 全局变量和状态 (Global Variables & State)
    // =================================================================================
    let titleFlashInterval = null;
    const originalTitle = document.title;
    let pageRefreshCountdownIntervalId = null;
    let pageRefreshRemainingTime = 0;
    let lastTickTime = Date.now();
    let gasSendCountdownIntervalId = null;
    let gasSendRemainingTime = 60;
    let isTyping = false;
    let isDetectorTestActive = false;
    let currentMessageCount = 'N/A';
    let idleCheckIntervalId = null;
    let lastSuccessfulSendTimestamp = GM_getValue('lastSuccessfulSendTimestamp_cat', 0);

    // =================================================================================
    // == [3] 核心功能函数 (Core Functions)
    // =================================================================================
    function getRandomRefreshInterval() {
        const min = parseFloat(config.minRefreshMinutes);
        const max = parseFloat(config.maxRefreshMinutes);
        if (isNaN(min) || isNaN(max) || min > max) {
            return (DEFAULTS.minRefreshMinutes + Math.random() * (DEFAULTS.maxRefreshMinutes - DEFAULTS.minRefreshMinutes)) * 60 * 1000;
        }
        return (min + Math.random() * (max - min)) * 60 * 1000;
    }

    function sendGoogleScriptRequest(data) {
        if (!config.googleScriptUrl || !config.googleScriptUrl.startsWith("https://script.google.com/")) {
            GM_log("Google Apps Script URL 未配置或无效。");
            if (data.type === 'statusUpdate') {
                alert("Google Apps Script URL 未配置或无效，无法更新状态表。请在设置中检查。");
            }
            return;
        }
        // 【修复点 2】使用原始日志函数，避免循环记录
        originalGmLog(`正在向 GAS 发送请求到 URL: ${config.googleScriptUrl}`, data);
        GM_xmlhttpRequest({
            method: "POST",
            url: config.googleScriptUrl,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            data: JSON.stringify(data),
            onload: (response) => {
                GM_log(`GAS请求成功！状态码: ${response.status}，响应文本: ${response.responseText}`);
                if (response.status === 200 && response.responseText.includes("Success")) {
                    GM_log("GAS服务器报告成功处理请求。");
                    if (data.type === 'statusUpdate') {
                        lastSuccessfulSendTimestamp = Date.now();
                        GM_setValue('lastSuccessfulSendTimestamp_cat', lastSuccessfulSendTimestamp);
                        GM_log(`已更新上次成功发送时间戳: ${new Date(lastSuccessfulSendTimestamp).toLocaleString()}`);
                    }
                } else {
                    GM_log(`GAS服务器返回非成功响应。状态: ${response.status}, 响应: ${response.responseText}`);
                }
            },
            onerror: (response) => {
                GM_log(`GAS请求错误: 状态码: ${response.status}，状态文本: ${response.statusText}，响应文本: ${response.responseText}`);
            },
            ontimeout: () => { GM_log(`GAS请求超时！`); },
            onabort: () => { GM_log(`GAS请求被中止！`); }
        });
    }

    function sendRemoteStatus() {
        const pageRefreshTotalSeconds = Math.max(0, Math.floor(pageRefreshRemainingTime / 1000));
        const pageRefreshMinutes = Math.floor(pageRefreshTotalSeconds / 60);
        const pageRefreshSeconds = pageRefreshTotalSeconds % 60;
        const formattedPageRefreshCountdown = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;

        const recentLogs = scriptLogs.slice(Math.max(0, scriptLogs.length - 20));

        const statusData = {
            type: 'statusUpdate',
            countdown: formattedPageRefreshCountdown,
            messageCount: currentMessageCount,
            logs: recentLogs
        };
        // 【修复点 1】使用原始日志函数，避免循环记录
        originalGmLog(`发送状态更新到GAS: 倒计时=${formattedPageRefreshCountdown}, 消息数=${currentMessageCount}, 日志条数=${recentLogs.length}`);
        sendGoogleScriptRequest(statusData);
    }


    function sendLogoutEmail() {
        if (!config.enableEmail) return;
        GM_log("发送掉线警告邮件。");
        sendGoogleScriptRequest({
            subject: "【重要】Cat in a Flat 掉线警告！",
            message: "脚本检测到您可能已从 Cat in a Flat 网站掉线，请尽快重新登录以确保监控正常运行。"
        });
    }

    function sendMasterNotification(count, isTest = false) {
        GM_log(`触发主通知流程，消息数: ${count}，是否为测试: ${isTest}`);
        const titlePrefix = isTest ? '【测试】' : '';

        if (config.enableSound) playSound();
        if (config.enableTitleFlash) startTitleFlash(count);
        if (config.enablePopup) {
            GM_notification({
                title: `${titlePrefix}Cat in a Flat 有新消息！`,
                text: `您有 ${count} 条新消息在 'New Job Notice Board'。`,
                image: 'https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk',
                timeout: 15000,
                onclick: () => { window.focus(); stopTitleFlash(); },
                ondone: stopTitleFlash,
            });
        }

        if (config.enableEmail) {
            GM_log(`发送新消息邮件通知: 消息数=${count}。`);
            sendGoogleScriptRequest({
                subject: `Cat in a Flat ${isTest ? '(脚本测试邮件)' : '有新消息！'}`,
                message: `有 ${count} 个新猫活咪！`
            });
        }
    }

    function observeMessages(targetNode) {
        let lastMessageCount = GM_getValue('lastMessageCount_uk', 0);
        GM_log(`初始化监控。上次消息数量为: ${lastMessageCount}`);

        const getMessageCount = () => {
            const countSpan = targetNode.querySelector("span[data-bind='text: messages().length']");
            return (countSpan && countSpan.textContent.trim() !== "") ? parseInt(countSpan.textContent, 10) : null;
        };

        const handleCountCheck = () => {
            const count = getMessageCount();
            if (count === null) return;
            currentMessageCount = count;

            if (count > lastMessageCount) {
                const isTriggeredByTest = isDetectorTestActive;
                GM_log(`✅ 探测器捕捉到新消息！从 ${lastMessageCount} 条变为 ${count} 条。`);
                sendMasterNotification(count, isTriggeredByTest);
                if (isDetectorTestActive) isDetectorTestActive = false;
                lastMessageCount = count;
                GM_setValue('lastMessageCount_uk', count);
            } else if (count < lastMessageCount) {
                GM_log(`消息数减少。从 ${lastMessageCount} 条变为 ${count} 条。同步更新。`);
                lastMessageCount = count;
                GM_setValue('lastMessageCount_uk', count);
            }
        };

        const observer = new MutationObserver(handleCountCheck);
        observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
        setTimeout(handleCountCheck, 1500);
    }

    function playSound() {
        if (!config.enableSound) return;
        try {
            const audioContext = new(window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5); // Shorter sound
        } catch (e) {
            GM_log("无法播放提示音。", e);
        }
    }

    function startTitleFlash(count) {
        if (!config.enableTitleFlash || document.hasFocus()) return;
        stopTitleFlash();
        let isToggled = false;
        titleFlashInterval = setInterval(() => {
            document.title = isToggled ? originalTitle : `(${count}) 新消息! - ${originalTitle}`;
            isToggled = !isToggled;
        }, 1000);
    }

    function stopTitleFlash() {
        if (titleFlashInterval) {
            clearInterval(titleFlashInterval);
            titleFlashInterval = null;
            document.title = originalTitle;
        }
    }
    window.addEventListener('focus', stopTitleFlash);

    function updateCountdownDisplay() {
        const uiInfoDisplayDiv = document.getElementById('ciaf-info-display');
        if (!uiInfoDisplayDiv) return;

        const pageRefreshMinutes = Math.floor(Math.max(0, pageRefreshRemainingTime) / 1000 / 60);
        const pageRefreshSeconds = Math.floor(Math.max(0, pageRefreshRemainingTime) / 1000 % 60);
        const formattedPageRefresh = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;

        const gasSendMinutes = Math.floor(Math.max(0, gasSendRemainingTime) / 60);
        const gasSendSeconds = Math.floor(Math.max(0, gasSendRemainingTime) % 60);
        const formattedGasSend = `${String(gasSendMinutes).padStart(2, '0')}:${String(gasSendSeconds).padStart(2, '0')}`;

        const lastSendTime = lastSuccessfulSendTimestamp ? new Date(lastSuccessfulSendTimestamp).toLocaleTimeString() : 'N/A';

        let typingStatus = (isTyping && config.pauseWhileTyping) ? ' (输入中)' : '';

        uiInfoDisplayDiv.innerHTML = `
            <div>猫猫监控🐱</div>
            <div><small>上次更新: ${lastSendTime}</small></div>
            <div>消息板: <span style="font-weight: bold; color: yellow;">${currentMessageCount}</span></div>
            <div>页面刷新: ${formattedPageRefresh}${typingStatus}</div>
            <div>GAS更新: ${formattedGasSend}</div>
            <div id="ciaf-quick-logs-display" style="font-size: 11px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 5px; text-align: left;">
            </div>
        `;
        updateQuickLogDisplay();
    }

    function startPageRefreshTimer(isManualReset = false) {
        if (pageRefreshCountdownIntervalId) clearInterval(pageRefreshCountdownIntervalId);
        if (isManualReset || pageRefreshRemainingTime <= 0) {
            pageRefreshRemainingTime = getRandomRefreshInterval();
        }
        GM_log(`页面刷新计时器已启动。将在 ${Math.round(pageRefreshRemainingTime / 60000)} 分钟后刷新。`);

        lastTickTime = Date.now();
        const tick = () => {
            const now = Date.now();
            const elapsed = now - lastTickTime;
            lastTickTime = now;

            if (!(isTyping && config.pauseWhileTyping)) {
                pageRefreshRemainingTime -= elapsed;
            }
            updateCountdownDisplay();

            if (pageRefreshRemainingTime <= 0) {
                clearInterval(pageRefreshCountdownIntervalId);
                window.location.reload();
            }
        };
        pageRefreshCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay();
    }

    function startGasSendCountdown() {
        if (gasSendCountdownIntervalId) clearInterval(gasSendCountdownIntervalId);
        gasSendRemainingTime = 60;
        const tick = () => {
            if (!(isTyping && config.pauseWhileTyping)) {
                gasSendRemainingTime -= 1;
                if (gasSendRemainingTime < 0) {
                    gasSendRemainingTime = 59;
                }
            }
            updateCountdownDisplay();
        };
        gasSendCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay();
    }

    function setupTypingDetector() {
        const isEditable = e => e.target.matches('input, textarea, [contenteditable="true"]');
        document.addEventListener('focusin', e => { if (isEditable(e)) { isTyping = true; updateCountdownDisplay(); }});
        document.addEventListener('focusout', e => { if (isEditable(e)) { isTyping = false; updateCountdownDisplay(); }});
    }

    // --- The rest of the script (UI creation, main logic, etc.) remains unchanged ---
    // --- I will omit it here for brevity, but you should keep it in your script. ---
    // --- The following is the continuation of the script ---

    function createUI() {
        GM_addStyle(`
            .ciaf-ui-container { position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; font-family: Arial, sans-serif; background-color: rgba(0, 0, 0, 0.7); color: white; border-radius: 8px; padding: 10px 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-size: 14px; line-height: 1.4; min-width: 200px; max-width: 250px; text-align: left; }
            .ciaf-ui-container div { margin-bottom: 3px; }
            #ciaf-quick-logs-display { word-break: break-all; font-size: 11px; white-space: pre-wrap; overflow-y: hidden; max-height: none; text-align: left !important; line-height: 1.3; }
            .ciaf-button { padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; transition: background-color 0.2s; text-align: center; font-weight: bold; color: white !important; opacity: 1 !important; pointer-events: auto !important; box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important; }
            .ciaf-button:hover { filter: brightness(1.1); }
            #ciaf-refresh-btn { background-color: #28a745 !important; } #ciaf-refresh-btn:hover { background-color: #218838 !important; }
            #ciaf-settings-btn { background-color: #007bff !important; } #ciaf-settings-btn:hover { background-color: #0069d9 !important; }
            .ciaf-settings-panel { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; height: 80vh; background: #f9f9f9; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); z-index: 10000; padding: 20px; color: #333; box-sizing: border-box; flex-direction: column; }
            .ciaf-settings-panel.visible { display: flex; } .ciaf-settings-panel h2 { margin-top: 0; text-align: center; color: #0056b3; margin-bottom: 15px; flex-shrink: 0; }
            #ciaf-close-settings-btn { background: none !important; border: none !important; color: #888 !important; font-size: 24px !important; cursor: pointer !important; opacity: 1 !important; pointer-events: auto !important; position: absolute; top: 10px; right: 10px; line-height: 1; }
            .ciaf-settings-tabs { display: flex; margin-bottom: 15px; border-bottom: 1px solid #eee; flex-shrink: 0; }
            .ciaf-settings-tab-button { padding: 10px 15px; cursor: pointer; background: #eee !important; border: 1px solid #ccc !important; border-bottom: none !important; border-top-left-radius: 5px !important; border-top-right-radius: 5px !important; margin-right: 5px; font-weight: bold; color: #333 !important; opacity: 1 !important; pointer-events: auto !important; }
            .ciaf-settings-tab-button.active { background: #f9f9f9 !important; border-color: #ccc !important; border-bottom-color: #f9f9f9 !important; color: #000 !important; }
            .ciaf-settings-tab-content { flex-grow: 1; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 5px; background: #fff; display: none; flex-direction: column; }
            .ciaf-settings-tab-content.active { display: flex; }
            .form-group { margin-bottom: 15px; } .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            .form-group input[type="text"], .form-group input[type="number"] { width: calc(100% - 2px); padding: 8px; border-radius: 4px; border: 1px solid #ccc; box-sizing: border-box; }
            .checkbox-group label { display: inline-block; margin-right: 15px; font-weight: normal; }
            .ciaf-tab-button-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; padding-top: 15px; border-top: 1px solid #eee; flex-shrink: 0; }
            #ciaf-save-settings-btn { background-color: #28a745 !important; } #ciaf-save-settings-btn:hover { background-color: #218838 !important; }
            #ciaf-reset-settings-btn { background-color: #ffc107 !important; color: black !important; } #ciaf-reset-settings-btn:hover { background-color: #e0a800 !important; }
            .ciaf-test-buttons-section { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; flex-shrink: 0; }
            #ciaf-test-notifications-btn { background-color: #6f42c1 !important; } #ciaf-test-notifications-btn:hover { background-color: #5a32a3 !important; }
            #ciaf-test-detector-btn { background-color: #dc3545 !important; } #ciaf-test-detector-btn:hover { background-color: #c82333 !important; }
            #ciaf-test-sheet-btn { background-color: #17a2b8 !important; } #ciaf-test-sheet-btn:hover { background-color: #138496 !important; }
            #ciaf-script-log-content { width: 100%; height: 100%; resize: vertical; border: none; background: #fff; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
            #ciaf-clear-log-btn { background-color: #dc3545 !important; margin-top: 10px; flex-shrink: 0; } #ciaf-clear-log-btn:hover { background-color: #c82333 !important; }
        `);
        const uiContainer = document.createElement('div');
        uiContainer.className = 'ciaf-ui-container';
        document.body.appendChild(uiContainer);

        const infoDisplayDiv = document.createElement('div');
        infoDisplayDiv.id = 'ciaf-info-display';
        uiContainer.appendChild(infoDisplayDiv);

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'ciaf-button';
        refreshBtn.id = 'ciaf-refresh-btn';
        refreshBtn.textContent = '立即刷新';
        refreshBtn.onclick = () => window.location.reload();
        uiContainer.appendChild(refreshBtn);

        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'ciaf-button';
        settingsBtn.id = 'ciaf-settings-btn';
        settingsBtn.innerHTML = '⚙️ 设置';
        uiContainer.appendChild(settingsBtn);

        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'ciaf-settings-panel';
        settingsPanel.className = 'ciaf-settings-panel';
        document.body.appendChild(settingsPanel);

        settingsBtn.onclick = () => {
            settingsPanel.classList.toggle('visible');
            if (settingsPanel.classList.contains('visible')) {
                loadSettingsToPanel();
                showSettingsTab('settings');
            }
        };

        buildSettingsPanelContent(settingsPanel);
    }

    function buildSettingsPanelContent(panelElement) {
        panelElement.innerHTML = `
            <button id="ciaf-close-settings-btn">&times;</button>
            <h2>脚本设置</h2>
            <div class="ciaf-settings-tabs">
                <button id="ciaf-tab-button-settings" class="ciaf-settings-tab-button active">设置</button>
                <button id="ciaf-tab-button-log" class="ciaf-settings-tab-button">脚本日志</button>
            </div>
            <div id="ciaf-tab-content-settings" class="ciaf-settings-tab-content active">
                <div style="flex-grow: 1; overflow-y: auto; padding-right: 10px;">
                    <div class="form-group">
                        <label for="ciaf-refresh-min">刷新间隔 (分钟, 随机范围)</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="number" id="ciaf-refresh-min" min="1">
                            <span>到</span>
                            <input type="number" id="ciaf-refresh-max" min="1">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="ciaf-google-url">Google Apps Script URL</label>
                        <input type="text" id="ciaf-google-url" placeholder="粘贴你的URL">
                    </div>
                    <div class="form-group">
                        <label for="ciaf-idle-alert-minutes">休眠提醒时间 (分钟)</label>
                        <input type="number" id="ciaf-idle-alert-minutes" min="5" step="5">
                    </div>
                    <div class="form-group">
                        <label>通知类型</label>
                        <div class="checkbox-group">
                            <label><input type="checkbox" id="ciaf-enable-email"> 邮件</label>
                            <label><input type="checkbox" id="ciaf-enable-sound"> 声音</label>
                            <label><input type="checkbox" id="ciaf-enable-popup"> 弹窗</label>
                            <label><input type="checkbox" id="ciaf-enable-titleflash"> 标签闪烁</label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>高级设置</label>
                        <div class="checkbox-group">
                            <label><input type="checkbox" id="ciaf-pause-typing"> 输入时暂停刷新</label>
                        </div>
                    </div>
                </div>
                <div class="ciaf-test-buttons-section">
                     <button id="ciaf-test-notifications-btn" class="ciaf-button">① 测试通知功能</button>
                     <button id="ciaf-test-detector-btn" class="ciaf-button">② 触发消息探测</button>
                     <button id="ciaf-test-sheet-btn" class="ciaf-button">③ 测试/更新状态表</button>
                </div>
                <div class="ciaf-tab-button-group">
                    <button id="ciaf-save-settings-btn" class="ciaf-button">保存设置</button>
                    <button id="ciaf-reset-settings-btn" class="ciaf-button">恢复默认</button>
                </div>
            </div>
            <div id="ciaf-tab-content-log" class="ciaf-settings-tab-content">
                <textarea id="ciaf-script-log-content" readonly></textarea>
                <button id="ciaf-clear-log-btn" class="ciaf-button">清空日志</button>
            </div>
        `;

        panelElement.querySelector('#ciaf-close-settings-btn').onclick = () => panelElement.classList.remove('visible');
        panelElement.querySelector('#ciaf-tab-button-settings').onclick = () => showSettingsTab('settings');
        panelElement.querySelector('#ciaf-tab-button-log').onclick = () => showSettingsTab('log');
        panelElement.querySelector('#ciaf-save-settings-btn').onclick = applySettingsFromPanel;
        panelElement.querySelector('#ciaf-reset-settings-btn').onclick = resetConfig;
        panelElement.querySelector('#ciaf-clear-log-btn').onclick = clearScriptLogs;

        panelElement.querySelector('#ciaf-test-notifications-btn').onclick = () => { if(confirm("测试通知功能?")){ sendMasterNotification(1, true); }};
        panelElement.querySelector('#ciaf-test-detector-btn').onclick = () => {
             if (!confirm("模拟消息变化测试?")) return;
             try {
                 const countSpan = document.querySelector('a.show-messages[href="#New Job Notice Board"] span[data-bind="text: messages().length"]');
                 if (!countSpan) throw new Error("无法找到消息计数元素");
                 isDetectorTestActive = true;
                 const currentCount = parseInt(countSpan.textContent, 10) || 0;
                 const newCount = currentCount + 1;
                 countSpan.textContent = newCount;
                 GM_log(`消息探测测试：已将页面消息数修改为 ${newCount}。`);
                 alert(`操作成功！已将页面消息数修改为 ${newCount}。`);
             } catch(e) {
                 isDetectorTestActive = false;
                 alert(`消息探测测试失败: ${e.message}`);
                 GM_log(`消息探测测试失败: ${e}`);
             }
        };
        panelElement.querySelector('#ciaf-test-sheet-btn').onclick = () => { if(confirm("发送一次状态更新到Google Sheet?")){ sendRemoteStatus(); alert("请求已发送!"); }};
    }

    function showSettingsTab(tabId) {
        document.querySelectorAll('.ciaf-settings-tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.ciaf-settings-tab-button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`ciaf-tab-content-${tabId}`).classList.add('active');
        document.getElementById(`ciaf-tab-button-${tabId}`).classList.add('active');
        if (tabId === 'log') {
            updateScriptLogDisplay();
        }
    }

    function clearScriptLogs() {
        if (confirm("您确定要清空所有脚本日志吗？")) {
            scriptLogs = [];
            GM_setValue(GM_STORAGE_LOG_KEY, '[]');
            updateScriptLogDisplay();
        }
    }

    function loadSettingsToPanel() {
        document.getElementById('ciaf-refresh-min').value = config.minRefreshMinutes;
        document.getElementById('ciaf-refresh-max').value = config.maxRefreshMinutes;
        document.getElementById('ciaf-google-url').value = config.googleScriptUrl;
        document.getElementById('ciaf-idle-alert-minutes').value = config.idleAlertMinutes;
        document.getElementById('ciaf-enable-email').checked = config.enableEmail;
        document.getElementById('ciaf-enable-sound').checked = config.enableSound;
        document.getElementById('ciaf-enable-popup').checked = config.enablePopup;
        document.getElementById('ciaf-enable-titleflash').checked = config.enableTitleFlash;
        document.getElementById('ciaf-pause-typing').checked = config.pauseWhileTyping;
    }

    function applySettingsFromPanel() {
        config.minRefreshMinutes = document.getElementById('ciaf-refresh-min').value;
        config.maxRefreshMinutes = document.getElementById('ciaf-refresh-max').value;
        config.googleScriptUrl = document.getElementById('ciaf-google-url').value.trim();
        config.idleAlertMinutes = parseFloat(document.getElementById('ciaf-idle-alert-minutes').value);
        config.enableEmail = document.getElementById('ciaf-enable-email').checked;
        config.enableSound = document.getElementById('ciaf-enable-sound').checked;
        config.enablePopup = document.getElementById('ciaf-enable-popup').checked;
        config.enableTitleFlash = document.getElementById('ciaf-enable-titleflash').checked;
        config.pauseWhileTyping = document.getElementById('ciaf-pause-typing').checked;
        saveConfig();
        document.getElementById('ciaf-settings-panel').classList.remove('visible');
        startPageRefreshTimer(true);
        startGasSendCountdown();
        startIdleAlertChecker();
    }

    function startIdleAlertChecker() {
        if (idleCheckIntervalId) clearInterval(idleCheckIntervalId);
        idleCheckIntervalId = setInterval(checkIdleStatus, 60 * 1000);
        GM_log("长时间未更新检查器已启动。");
    }

    function checkIdleStatus() {
        const thresholdMillis = config.idleAlertMinutes * 60 * 1000;
        const timeSinceLastSend = Date.now() - lastSuccessfulSendTimestamp;
        originalGmLog(`检查空闲状态。上次成功发送: ${Math.floor(timeSinceLastSend / 60000)} 分钟前)`);
        if (timeSinceLastSend > thresholdMillis && lastSuccessfulSendTimestamp !== 0) {
            GM_log(`⚠️ 警告：已长时间未更新状态！`);
            GM_notification({
                title: `【提醒】Cat in a Flat 状态未更新！`,
                text: `您的脚本已超过 ${config.idleAlertMinutes} 分钟未成功发送状态。`,
                image: 'https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk',
                timeout: 0,
                onclick: () => window.focus(),
            });
            if (config.enableSound) playSound();
        }
    }

    function main() {
        loadConfig();
        loadScriptLogs();
        window.addEventListener('beforeunload', saveScriptLogs);

        setTimeout(() => {
            if (document.querySelector('#login-link')) {
                GM_log("模式检测：发现 'Login' 链接，进入【掉线处理模式】。");
                if (!GM_getValue('logout_notified', false)) {
                    sendLogoutEmail();
                    GM_setValue('logout_notified', true);
                }
                return;
            }

            GM_log("模式检测：未发现 'Login' 链接，进入【在线监控模式】。");
            if (GM_getValue('logout_notified', false)) {
                GM_setValue('logout_notified', false);
            }

            const startupInterval = setInterval(() => {
                const anchor = document.querySelector('a.show-messages[href="#New Job Notice Board"]');
                if (anchor) {
                    const targetNode = anchor.querySelector('.SectionFolder-head--title.SectionFolder-head--underline');
                    if (targetNode) {
                        clearInterval(startupInterval);
                        GM_log(`成功找到目标面板，脚本完全启动 (v${GM_info.script.version})。`);
                        createUI();
                        if (config.pauseWhileTyping) setupTypingDetector();
                        observeMessages(targetNode);
                        startPageRefreshTimer();
                        setInterval(sendRemoteStatus, 60000);
                        startGasSendCountdown();
                        startIdleAlertChecker();
                    }
                }
            }, 1000);
        }, 3000);
    }

    main();
})();
