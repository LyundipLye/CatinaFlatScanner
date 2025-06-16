// ==UserScript==
// @name         Cat in a Flat UK Monitor
// @namespace    http://tampermonkey.net/
// @version      8.0.2
// @description  Cat in a Flat 网站监控脚本：新增本地唤醒检测，修复休眠后无提示问题；优化远程心跳检测逻辑。
// @author       Gemini & CaitLye
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
        minRefreshMinutes: 7, // 页面最小刷新间隔 (分钟)
        maxRefreshMinutes: 10, // 页面最大刷新间隔 (分钟)
        googleScriptUrl: "https://script.google.com/macros/s/AKfycbykkMpNw5TvgisICLy9O6w2FYOSZiDKfCFS0RTTHO_cr_TYnO-ZOYNAoBpZacqKYeTl/exec",
        enableEmail: true, // 是否启用邮件通知
        enableSound: true, // 是否启用声音通知
        enablePopup: true, // 是否启用浏览器弹窗通知
        enableTitleFlash: true, // 浏览器标签页标题闪烁是否默认启用
        pauseWhileTyping: true, // 输入时是否暂停刷新计时器
        gasFailureAlertMinutes: 30, // 多少分钟未成功与Google Sheet通信则触发本地提醒
    };

    let config = {}; // 当前生效的配置
    const SCRIPT_LOGS_MAX_LINES = 200;
    const GM_STORAGE_LOG_KEY = 'catScriptPersistentLogs';
    let scriptLogs = [];
    const QUICK_LOG_DISPLAY_COUNT = 3;

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
        updateQuickLogDisplay();
    }

    const originalGmLog = GM_log;
    GM_log = function(...args) {
        originalGmLog.apply(this, args);
        const timestamp = new Date().toLocaleTimeString();
        let logMessage = args.map(arg => typeof arg === 'object' && arg !== null ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
        scriptLogs.push(`[${timestamp}] ${logMessage}`);
        if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) scriptLogs.shift();
        updateScriptLogDisplay();
    };

    function loadConfig() {
        const savedConfig = GM_getValue('catScriptConfig_v8', {}); // 使用新版本键名
        config = { ...DEFAULTS, ...savedConfig };
        GM_log("配置已加载: ", config);
    }

    function saveConfig() {
        GM_setValue('catScriptConfig_v8', config);
        alert("设置已保存！部分设置将在下次刷新或手动重置计时器后生效。");
        GM_log("配置已保存: ", config);
    }

    function resetConfig() {
        if (confirm("您确定要将所有设置重置为默认值吗？")) {
            config = { ...DEFAULTS };
            GM_setValue('catScriptConfig_v8', {});
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
    let lastSuccessfulSendTimestamp = GM_getValue('lastSuccessfulSendTimestamp_cat', 0);

    // 新增：心跳检测相关变量
    let lastHeartbeatCheckTimestamp = Date.now();
    let heartbeatIntervalId = null;
    let isTabStale = false; // 标记标签页是否刚从休眠中唤醒

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
            return;
        }
        GM_log(`正在向 GAS 发送请求`, data);
        GM_xmlhttpRequest({
            method: "POST",
            url: config.googleScriptUrl,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            data: JSON.stringify(data),
            onload: (response) => {
                GM_log(`GAS请求成功！状态: ${response.status}`);
                if (response.status === 200 && response.responseText.includes("Success")) {
                    if (data.type === 'statusUpdate') {
                        lastSuccessfulSendTimestamp = Date.now();
                        GM_setValue('lastSuccessfulSendTimestamp_cat', lastSuccessfulSendTimestamp);
                        GM_log(`已更新上次成功发送时间戳: ${new Date(lastSuccessfulSendTimestamp).toLocaleString()}`);
                    }
                }
            },
            onerror: (response) => { GM_log(`GAS请求错误:`, response); },
            ontimeout: () => { GM_log(`GAS请求超时！`); },
            onabort: () => { GM_log(`GAS请求被中止！`); }
        });
    }

    function sendRemoteStatus() {
        const pageRefreshTotalSeconds = Math.max(0, Math.floor(pageRefreshRemainingTime / 1000));
        const pageRefreshMinutes = Math.floor(pageRefreshTotalSeconds / 60);
        const pageRefreshSeconds = pageRefreshTotalSeconds % 60;
        const formattedPageRefreshCountdown = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;
        const statusData = {
            type: 'statusUpdate',
            countdown: formattedPageRefreshCountdown,
            messageCount: currentMessageCount,
        };
        GM_log(`发送状态更新到GAS: 倒计时=${formattedPageRefreshCountdown}, 消息数=${currentMessageCount}`);
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
            oscillator.stop(audioContext.currentTime + 5);
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
        const typingStatus = (isTyping && config.pauseWhileTyping) ? ' (输入中)' : '';

        // 新增：心跳状态显示
        const heartbeatStatus = isTabStale ? '<div style="color: orange; font-weight: bold; text-align: center;">⚠️ 刚从休眠中唤醒</div>' : '';

        uiInfoDisplayDiv.innerHTML = `
            ${heartbeatStatus}
            <div>猫猫监控🐱 <span style="font-size: 10px;">v${GM_info.script.version}</span></div>
            <div><small>上次更新: ${lastSendTime}</small></div>
            <div>消息板: <span style="font-weight: bold; color: yellow;">${currentMessageCount}</span></div>
            <div>页面刷新: ${formattedPageRefresh}${typingStatus}</div>
            <div>GAS更新: ${formattedGasSend}</div>
        `;
        // 日志显示区独立，由 GM_log 触发更新
    }

    function updateQuickLogDisplay() {
        const quickLogsDiv = document.getElementById('ciaf-quick-logs');
        if (quickLogsDiv) {
            const recentLogsDisplay = scriptLogs.slice(-QUICK_LOG_DISPLAY_COUNT).map(log => escapeHtml(log)).join('<br>');
            quickLogsDiv.innerHTML = recentLogsDisplay;
        }
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
                if (gasSendRemainingTime < 0) gasSendRemainingTime = 59;
            }
            updateCountdownDisplay();
        };
        gasSendCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay();
    }

    function setupTypingDetector() {
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, textarea, [contenteditable="true"]')) { isTyping = true; updateCountdownDisplay(); }
        });
        document.addEventListener('focusout', (e) => {
            if (e.target.matches('input, textarea, [contenteditable="true"]')) { isTyping = false; updateCountdownDisplay(); }
        });
    }

    // =================================================================================
    // == [4] 告警系统 (Alerting Systems)
    // =================================================================================
    let gasFailureCheckIntervalId = null;

    /**
     * [4.1] 启动标签页心跳检测 (本地唤醒检测)
     * 检测浏览器标签页是否因休眠或被浏览器节流而长时间暂停。
     */
    function startTabHeartbeatMonitor() {
        if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);

        const checkInterval = 60 * 1000; // 每 1 分钟检查一次
        const staleThreshold = 60 * 5000; // 阈值：5 分钟

        lastHeartbeatCheckTimestamp = Date.now();
        isTabStale = false;

        heartbeatIntervalId = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastHeartbeatCheckTimestamp;

            if (elapsed > staleThreshold) {
                isTabStale = true;
                GM_log(`💓 心跳检测：检测到页面从休眠中唤醒 (暂停了 ${Math.round(elapsed/1000)} 秒)。`);
                GM_notification({
                    title: `【唤醒提醒】Cat in a Flat 监控已恢复`,
                    text: `脚本可能因电脑休眠而暂停。正在重新同步状态。建议检查页面是否需要手动刷新。`,
                    image: 'https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk',
                    timeout: 20000,
                    onclick: () => { window.focus(); },
                });
                if (config.enableSound) playSound();
                sendRemoteStatus(); // 强制发送一次状态更新
                setTimeout(() => { isTabStale = false; }, 15000); // 提示持续15秒
            }

            lastHeartbeatCheckTimestamp = now;
            updateCountdownDisplay();
        }, checkInterval);

        GM_log("💓 标签页心跳检测器已启动。");
    }

    /**
     * [4.2] 启动GAS通信失败检查器 (本地网络/配置问题检测)
     * 检查是否长时间未成功向Google Sheet发送状态。
     */
    function startGasFailureChecker() {
        if (gasFailureCheckIntervalId) clearInterval(gasFailureCheckIntervalId);
        gasFailureCheckIntervalId = setInterval(checkGasFailureStatus, 60 * 1000);
        GM_log("GAS通信失败检查器已启动。");
    }

    function checkGasFailureStatus() {
        const thresholdMillis = config.gasFailureAlertMinutes * 60 * 1000;
        const timeSinceLastSend = Date.now() - lastSuccessfulSendTimestamp;

        GM_log(`检查GAS通信状态。距上次成功 ${Math.floor(timeSinceLastSend / 60000)} 分钟。`);

        if (timeSinceLastSend > thresholdMillis && lastSuccessfulSendTimestamp !== 0) {
            GM_log(`⚠️ 警告：已超过 ${config.gasFailureAlertMinutes} 分钟未成功与GAS通信！`);
            GM_notification({
                title: `【本地警告】Cat in a Flat 状态未更新！`,
                text: `脚本已超过 ${config.gasFailureAlertMinutes} 分钟未成功发送状态。请检查网络、GAS URL配置或刷新页面。`,
                image: 'https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk',
                timeout: 0,
                onclick: () => { window.focus(); },
            });
            if (config.enableSound) playSound();
        }
    }


    // =================================================================================
    // == [5] UI创建与管理 (UI Creation & Management)
    // =================================================================================
    function createUI() {
        GM_addStyle(`
            .ciaf-ui-container { position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; font-family: Arial, sans-serif; background-color: rgba(0, 0, 0, 0.7); color: white; border-radius: 8px; padding: 10px 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-size: 14px; line-height: 1.4; min-width: 220px; text-align: left; transition: border-color 0.5s; }
            .ciaf-ui-container div { margin-bottom: 3px; }
            #ciaf-quick-logs { font-size: 11px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 5px; word-break: break-all; }
            .ciaf-button { padding: 8px 12px; border: none; border-radius: 5px; cursor: pointer; transition: background-color 0.2s; text-align: center; font-weight: bold; color: white !important; }
            .ciaf-button:hover { filter: brightness(1.1); }
            #ciaf-refresh-btn { background-color: #28a745 !important; }
            #ciaf-settings-btn { background-color: #007bff !important; }
            .ciaf-settings-panel { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; height: 80vh; background: #f9f9f9; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); z-index: 10000; padding: 20px; color: #333; box-sizing: border-box; flex-direction: column; }
            .ciaf-settings-panel.visible { display: flex; }
            .ciaf-settings-panel h2 { margin-top: 0; text-align: center; color: #0056b3; margin-bottom: 15px; }
            #ciaf-close-settings-btn { background: none !important; border: none !important; color: #888 !important; font-size: 24px !important; cursor: pointer !important; position: absolute; top: 10px; right: 15px; line-height: 1; padding: 0;}
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            .form-group input[type="text"], .form-group input[type="number"] { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ccc; box-sizing: border-box; }
            .ciaf-settings-tabs { display: flex; margin-bottom: 15px; border-bottom: 1px solid #eee; }
            .ciaf-settings-tab-button { padding: 10px 15px; cursor: pointer; background: #eee !important; border: 1px solid #ccc !important; border-bottom: none !important; margin-right: 5px; font-weight: bold; color: #333 !important;}
            .ciaf-settings-tab-button.active { background: #f9f9f9 !important; }
            .ciaf-settings-tab-content { flex-grow: 1; overflow-y: auto; border: 1px solid #ddd; padding: 15px; border-radius: 5px; background: #fff; display: none; flex-direction: column; }
            .ciaf-settings-tab-content.active { display: flex; }
            .ciaf-tab-button-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; padding-top: 15px; border-top: 1px solid #eee; }
            .ciaf-test-buttons-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; }
            #ciaf-script-log-content { width: 100%; height: 100%; resize: vertical; border: none; background: #fff; font-family: monospace; font-size: 12px; white-space: pre-wrap; flex-grow: 1; }
            #ciaf-clear-log-btn { background-color: #dc3545 !important; margin-top: 10px; }
        `);

        const uiContainer = document.createElement('div');
        uiContainer.className = 'ciaf-ui-container';
        uiContainer.id = 'ciaf-main-ui-container';
        uiContainer.innerHTML = `
            <div id="ciaf-info-display"></div>
            <div id="ciaf-quick-logs"></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 5px;">
                <button id="ciaf-refresh-btn" class="ciaf-button">立即刷新</button>
                <button id="ciaf-settings-btn" class="ciaf-button">⚙️ 设置</button>
            </div>
        `;
        document.body.appendChild(uiContainer);

        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'ciaf-settings-panel';
        settingsPanel.className = 'ciaf-settings-panel';
        document.body.appendChild(settingsPanel);

        buildSettingsPanelContent(settingsPanel);

        document.getElementById('ciaf-refresh-btn').onclick = () => window.location.reload();
        document.getElementById('ciaf-settings-btn').onclick = () => {
            const panel = document.getElementById('ciaf-settings-panel');
            panel.classList.add('visible');
            loadSettingsToPanel();
            showSettingsTab('settings');
            updateScriptLogDisplay();
        };
    }

    function buildSettingsPanelContent(panel) {
        panel.innerHTML = `
            <button id="ciaf-close-settings-btn">&times;</button>
            <h2>脚本设置</h2>
            <div class="ciaf-settings-tabs">
                <button id="ciaf-tab-button-settings" class="ciaf-settings-tab-button active">通用设置</button>
                <button id="ciaf-tab-button-log" class="ciaf-settings-tab-button">脚本日志</button>
            </div>

            <div id="ciaf-tab-content-settings" class="ciaf-settings-tab-content active">
                <div style="flex-grow:1; overflow-y:auto; padding-right:10px;">
                    <div class="form-group">
                        <label>刷新间隔 (分钟, 随机范围)</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="number" id="ciaf-refresh-min" min="1" style="width: 80px;">
                            <span>到</span>
                            <input type="number" id="ciaf-refresh-max" min="1" style="width: 80px;">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="ciaf-google-url">Google Apps Script URL</label>
                        <input type="text" id="ciaf-google-url" placeholder="粘贴你的URL">
                    </div>
                    <div class="form-group">
                        <label for="ciaf-gas-failure-minutes">本地警告阈值 (分钟)</label>
                        <input type="number" id="ciaf-gas-failure-minutes" min="5" step="5" title="如果在这个时间内未能成功与GAS通信，将触发浏览器本地提醒。">
                    </div>
                    <div class="form-group">
                        <label>通知类型</label>
                        <label><input type="checkbox" id="ciaf-enable-email"> 邮件</label>
                        <label><input type="checkbox" id="ciaf-enable-sound"> 声音</label>
                        <label><input type="checkbox" id="ciaf-enable-popup"> 弹窗</label>
                        <label><input type="checkbox" id="ciaf-enable-titleflash"> 标签闪烁</label>
                    </div>
                    <div class="form-group">
                        <label>高级设置</label>
                        <label><input type="checkbox" id="ciaf-pause-typing"> 输入时暂停刷新</label>
                    </div>
                    <div class="ciaf-test-buttons-section">
                        <button id="ciaf-test-notifications-btn" class="ciaf-button" style="background-color:#6f42c1 !important;">① 测试通知</button>
                        <button id="ciaf-test-detector-btn" class="ciaf-button" style="background-color:#dc3545 !important;">② 触发探测</button>
                        <button id="ciaf-test-sheet-btn" class="ciaf-button" style="background-color:#17a2b8 !important;">③ 更新状态表</button>
                    </div>
                </div>
                <div class="ciaf-tab-button-group">
                    <button id="ciaf-save-settings-btn" class="ciaf-button" style="background-color:#28a745 !important;">保存设置</button>
                    <button id="ciaf-reset-settings-btn" class="ciaf-button" style="background-color:#ffc107 !important; color:black!important;">恢复默认</button>
                </div>
            </div>

            <div id="ciaf-tab-content-log" class="ciaf-settings-tab-content">
                <textarea id="ciaf-script-log-content" readonly></textarea>
                <button id="ciaf-clear-log-btn" class="ciaf-button">清空日志</button>
            </div>
        `;

        // 绑定事件
        panel.querySelector('#ciaf-close-settings-btn').onclick = () => panel.classList.remove('visible');
        panel.querySelector('#ciaf-tab-button-settings').onclick = () => showSettingsTab('settings');
        panel.querySelector('#ciaf-tab-button-log').onclick = () => showSettingsTab('log');
        panel.querySelector('#ciaf-save-settings-btn').onclick = applySettingsFromPanel;
        panel.querySelector('#ciaf-reset-settings-btn').onclick = resetConfig;
        panel.querySelector('#ciaf-clear-log-btn').onclick = clearScriptLogs;

        panel.querySelector('#ciaf-test-notifications-btn').onclick = () => { sendMasterNotification(1, true); alert("测试通知已发送"); };
        panel.querySelector('#ciaf-test-detector-btn').onclick = () => {
            try {
                const countSpan = document.querySelector("a.show-messages[href='#New Job Notice Board'] span[data-bind='text: messages().length']");
                if (!countSpan) throw new Error("无法找到消息计数元素");
                isDetectorTestActive = true;
                const currentCount = parseInt(countSpan.textContent, 10) || 0;
                countSpan.textContent = currentCount + 1;
                alert(`操作成功！已将页面消息数修改为 ${currentCount + 1}。`);
            } catch (e) {
                isDetectorTestActive = false;
                alert(`消息探测测试失败: ${e.message}。`);
            }
        };
        panel.querySelector('#ciaf-test-sheet-btn').onclick = () => { sendRemoteStatus(); alert("状态更新请求已发送！"); };
    }

    function showSettingsTab(tabId) {
        document.querySelectorAll('.ciaf-settings-tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.ciaf-settings-tab-button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`ciaf-tab-content-${tabId}`).classList.add('active');
        document.getElementById(`ciaf-tab-button-${tabId}`).classList.add('active');
        if (tabId === 'log') {
            const logContent = document.getElementById('ciaf-script-log-content');
            if (logContent) logContent.scrollTop = logContent.scrollHeight;
        }
    }

    function loadSettingsToPanel() {
        document.getElementById('ciaf-refresh-min').value = config.minRefreshMinutes;
        document.getElementById('ciaf-refresh-max').value = config.maxRefreshMinutes;
        document.getElementById('ciaf-google-url').value = config.googleScriptUrl;
        document.getElementById('ciaf-gas-failure-minutes').value = config.gasFailureAlertMinutes;
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
        config.gasFailureAlertMinutes = parseFloat(document.getElementById('ciaf-gas-failure-minutes').value);
        config.enableEmail = document.getElementById('ciaf-enable-email').checked;
        config.enableSound = document.getElementById('ciaf-enable-sound').checked;
        config.enablePopup = document.getElementById('ciaf-enable-popup').checked;
        config.enableTitleFlash = document.getElementById('ciaf-enable-titleflash').checked;
        config.pauseWhileTyping = document.getElementById('ciaf-pause-typing').checked;

        saveConfig();
        document.getElementById('ciaf-settings-panel').classList.remove('visible');

        // 重启相关计时器以应用新设置
        startPageRefreshTimer(true);
        startGasSendCountdown();
        startGasFailureChecker();
        startTabHeartbeatMonitor();
    }

    function loadScriptLogs() {
        const savedLogs = GM_getValue(GM_STORAGE_LOG_KEY, '[]');
        try { scriptLogs = JSON.parse(savedLogs).slice(-SCRIPT_LOGS_MAX_LINES); }
        catch (e) { scriptLogs = []; }
    }

    function saveScriptLogs() {
        try { GM_setValue(GM_STORAGE_LOG_KEY, JSON.stringify(scriptLogs)); }
        catch (e) { originalGmLog("保存日志失败!", e); }
    }

    function clearScriptLogs() {
        if (confirm("您确定要清空所有脚本日志吗？")) {
            scriptLogs = [];
            GM_setValue(GM_STORAGE_LOG_KEY, '[]');
            updateScriptLogDisplay();
            GM_log("脚本日志已清空。");
        }
    }

    // =================================================================================
    // == [6] 脚本启动逻辑 (Initialization Logic)
    // =================================================================================
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

            GM_log("模式检测：进入【在线监控模式】。");
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

                        // 启动所有告警系统
                        startTabHeartbeatMonitor();
                        startGasFailureChecker();
                    }
                }
            }, 1000);
        }, 3000);
    }

    main();
})();
