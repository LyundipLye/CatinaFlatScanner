// ==UserScript==
// @name         Cat in a Flat UK Monitor
// @namespace    http://tampermonkey.net/
// @version      7.9.2
// @description  Cat in a Flat 网站监控脚本：彻底修复因日志上报导致的递归日志问题，并优化日志清空逻辑与UI更新时序。
// @author       Gemini & Caitlye
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
        // Google Apps Script Web 应用的部署URL。请确保此URL是最新且有效的。
        googleScriptUrl: "https://script.google.com/macros/s/AKfycbzFBGLhzPMyjpuBpp4DWnjAf8y1DhzLWys-avVeAKmHTVDv4rnJZh22MbSSsIAiFPrl/exec",
        enableEmail: true, // 是否启用邮件通知
        enableSound: true, // 是否启用声音通知
        enablePopup: true, // 是否启用浏览器弹窗通知
        enableTitleFlash: true, // 浏览器标签页标题闪烁是否默认启用
        pauseWhileTyping: true, // 输入时是否暂停刷新计时器
        idleAlertMinutes: 30, // 多少分钟未向Google Sheet发送状态则触发提醒
    };

    let config = {}; // 当前生效的配置
    const SCRIPT_LOGS_MAX_LINES = 200; // 脚本内部日志最大保留行数
    const GM_STORAGE_LOG_KEY = 'catScriptPersistentLogs'; // GM_setValue/GM_getValue用于存储日志的键名
    let scriptLogs = []; // 用于存储脚本内部日志的数组
    const QUICK_LOG_DISPLAY_COUNT = 5; // 浮窗显示最近几条日志

    /**
     * HTML 转义工具函数，防止日志内容中的特殊字符被解析为HTML。
     * @param {string} str - 要转义的字符串。
     * @returns {string} 转义后的字符串。
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /**
     * 更新【设置面板】中的脚本日志显示。
     */
    function updateScriptLogDisplay() {
        const logContent = document.getElementById('ciaf-script-log-content');
        if (logContent) {
            logContent.textContent = scriptLogs.join('\n');
            logContent.scrollTop = logContent.scrollHeight; // 滚动到底部
        }
    }

    /**
     * 更新【主浮窗】中的快速日志显示。
     */
    function updateQuickLogDisplay() {
        const quickLogsDiv = document.getElementById('ciaf-quick-logs-display');
        if (quickLogsDiv) {
            const recentLogsDisplay = scriptLogs.slice(Math.max(0, scriptLogs.length - QUICK_LOG_DISPLAY_COUNT))
                .map(log => escapeHtml(log))
                .join('<br>');
            quickLogsDiv.innerHTML = recentLogsDisplay;
        }
    }


    /**
     * 覆盖原生的 GM_log，使其同时记录到内存数组、持久化存储和浏览器控制台。
     * @param {...any} args - 要记录的日志参数。
     */
    const originalGmLog = GM_log;
    GM_log = function(...args) {
        originalGmLog.apply(this, args); // 1. 记录到浏览器控制台

        // 2. 格式化并记录到内存数组
        const timestamp = new Date().toLocaleTimeString();
        let logMessage = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg, null, 2); // 尝试JSON格式化对象
                } catch (e) {
                    return String(arg); // 循环引用等情况的回退
                }
            }
            return String(arg);
        }).join(' ');

        scriptLogs.push(`[${timestamp}] ${logMessage}`);

        // 3. 限制日志行数
        if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) {
            scriptLogs.shift(); // 移除最旧的日志
        }

        // 4. 更新UI
        updateScriptLogDisplay();
        updateQuickLogDisplay();
    };

    /**
     * 从Tampermonkey存储加载配置。
     */
    function loadConfig() {
        const savedConfig = GM_getValue('catScriptConfig_v6', {});
        config = { ...DEFAULTS, ...savedConfig };
        GM_log("配置已加载: ", config);
    }

    /**
     * 保存当前配置到Tampermonkey存储。
     */
    function saveConfig() {
        GM_setValue('catScriptConfig_v6', config);
        alert("设置已保存！部分设置（如刷新时间）将在下次刷新或手动重置计时器后生效。");
        GM_log("配置已保存: ", config);
    }

    /**
     * 重置所有配置为默认值。
     */
    function resetConfig() {
        if (confirm("您确定要将所有设置重置为默认值吗？")) {
            config = { ...DEFAULTS };
            saveConfig();
            location.reload(); // 重新加载页面以应用默认设置
        }
    }

    // =================================================================================
    // == [2] 全局变量和状态 (Global Variables & State)
    // =================================================================================
    let titleFlashInterval = null; // 标题闪烁计时器ID
    const originalTitle = document.title; // 页面原始标题
    let pageRefreshCountdownIntervalId = null; // 页面刷新计时器ID
    let pageRefreshRemainingTime = 0; // 页面刷新剩余时间（毫秒）
    let lastTickTime = Date.now(); // 上次计时器tick的时间戳
    let gasSendCountdownIntervalId = null; // GAS发送倒计时计时器ID
    let gasSendRemainingTime = 60; // GAS发送剩余秒数，初始化为60秒
    let isTyping = false; // 是否正在输入
    let isDetectorTestActive = false; // 是否处于探测器测试模式
    let currentMessageCount = 'N/A'; // 当前消息板上的消息数量
    let idleCheckIntervalId = null; // 长时间未更新检查的计时器ID
    let lastSuccessfulSendTimestamp = GM_getValue('lastSuccessfulSendTimestamp_cat', 0); // 上次成功发送状态到GAS的时间戳

    // =================================================================================
    // == [3] 核心功能函数 (Core Functions)
    // =================================================================================

    /**
     * 生成随机的页面刷新间隔（毫秒）。
     * @returns {number} 随机刷新间隔（毫秒）。
     */
    function getRandomRefreshInterval() {
        const min = parseFloat(config.minRefreshMinutes);
        const max = parseFloat(config.maxRefreshMinutes);
        if (isNaN(min) || isNaN(max) || min > max) {
            return (DEFAULTS.minRefreshMinutes + Math.random() * (DEFAULTS.maxRefreshMinutes - DEFAULTS.minRefreshMinutes)) * 60 * 1000;
        }
        return (min + Math.random() * (max - min)) * 60 * 1000;
    }

    /**
     * 向Google Apps Script Web应用发送HTTP POST请求。
     * @param {object} data - 要发送的JSON数据。
     */
    function sendGoogleScriptRequest(data) {
        if (!config.googleScriptUrl || !config.googleScriptUrl.startsWith("https://script.google.com/")) {
            GM_log("Google Apps Script URL 未配置或无效。");
            if (data.type === 'statusUpdate') {
                alert("Google Apps Script URL 未配置或无效，无法更新状态表。请在设置中检查。");
            }
            return;
        }

        // 【最终修复】: 防止日志递归的核心。
        // 创建一个用于日志记录的数据副本，并从中移除或替换 'logs' 数组，
        // 以免将日志本身记录到日志中，造成无限循环。
        const loggableData = { ...data };
        if (loggableData.logs && Array.isArray(loggableData.logs)) {
            // 在日志中，用一条简短说明替代庞大的日志数组
            loggableData.logs = `(omitted ${loggableData.logs.length} log entries to prevent recursion)`;
        }
        GM_log(`正在向 GAS 发送请求...`, loggableData); // 使用净化后的数据进行日志记录

        GM_xmlhttpRequest({
            method: "POST",
            url: config.googleScriptUrl,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            data: JSON.stringify(data), // 确保发送的是包含完整日志的【原始数据】
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
            ontimeout: () => {
                GM_log(`GAS请求超时！`);
            },
            onabort: () => {
                GM_log(`GAS请求被中止！`);
            }
        });
    }


    /**
     * 发送远程状态更新到Google Sheet。
     */
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

        GM_log(`准备发送状态更新: 倒计时=${formattedPageRefreshCountdown}, 消息数=${currentMessageCount}, 日志条数=${recentLogs.length}`);
        sendGoogleScriptRequest(statusData);
    }


    /**
     * 发送掉线提醒邮件。
     */
    function sendLogoutEmail() {
        if (!config.enableEmail) return;
        GM_log("发送掉线警告邮件。");
        sendGoogleScriptRequest({
            subject: "【重要】Cat in a Flat 掉线警告！",
            message: "脚本检测到您可能已从 Cat in a Flat 网站掉线，请尽快重新登录以确保监控正常运行。"
        });
    }

    /**
     * 触发主通知流程（声音、弹窗、标题闪烁、邮件）。
     * @param {number} count - 新消息数量。
     * @param {boolean} isTest - 是否为测试通知。
     */
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

    /**
     * 监控消息板上的消息数量变化。
     * @param {HTMLElement} targetNode - 消息数量所在的DOM节点。
     */
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
            currentMessageCount = count; // 更新全局消息计数

            if (count > lastMessageCount) {
                const isTriggeredByTest = isDetectorTestActive;
                GM_log(`✅ 探测器捕捉到新消息！从 ${lastMessageCount} 条变为 ${count} 条。`);
                sendMasterNotification(count, isTriggeredByTest);
                if (isDetectorTestActive) isDetectorTestActive = false; // 测试模式仅触发一次
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

    /**
     * 播放提示音。
     */
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

    /**
     * 开始浏览器标签页标题闪烁。
     * @param {number} count - 新消息数量。
     */
    function startTitleFlash(count) {
        if (!config.enableTitleFlash || document.hasFocus()) return;
        stopTitleFlash();
        let isToggled = false;
        titleFlashInterval = setInterval(() => {
            document.title = isToggled ? originalTitle : `(${count}) 新消息! - ${originalTitle}`;
            isToggled = !isToggled;
        }, 1000);
    }

    /**
     * 停止浏览器标签页标题闪烁，并恢复原始标题。
     */
    function stopTitleFlash() {
        if (titleFlashInterval) {
            clearInterval(titleFlashInterval);
            titleFlashInterval = null;
            document.title = originalTitle;
        }
    }
    window.addEventListener('focus', stopTitleFlash);

    /**
     * 更新浮窗UI上的倒计时显示。
     */
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

        let typingStatus = '';
        if (isTyping && config.pauseWhileTyping) {
            typingStatus = ' (输入中)';
        }

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

    /**
     * 启动页面刷新计时器。
     * @param {boolean} isManualReset - 是否为手动重置。
     */
    function startPageRefreshTimer(isManualReset = false) {
        if (pageRefreshCountdownIntervalId) clearInterval(pageRefreshCountdownIntervalId);
        if (isManualReset || pageRefreshRemainingTime <= 0) {
            pageRefreshRemainingTime = getRandomRefreshInterval();
        }
        const totalDuration = Math.round(pageRefreshRemainingTime / 60000);
        GM_log(`页面刷新计时器已启动。将在 ${totalDuration} 分钟后刷新。`);

        lastTickTime = Date.now();
        const tick = () => {
            const now = Date.now();
            const elapsed = now - lastTickTime;
            lastTickTime = now;

            if (isTyping && config.pauseWhileTyping) {
                updateCountdownDisplay();
                return;
            }
            pageRefreshRemainingTime -= elapsed;
            updateCountdownDisplay();

            if (pageRefreshRemainingTime <= 0) {
                clearInterval(pageRefreshCountdownIntervalId);
                window.location.reload();
            }
        };
        pageRefreshCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay();
    }

    /**
     * 启动GAS发送倒计时。
     */
    function startGasSendCountdown() {
        if (gasSendCountdownIntervalId) clearInterval(gasSendCountdownIntervalId);
        gasSendRemainingTime = 60;
        const tick = () => {
            if (isTyping && config.pauseWhileTyping) {
                updateCountdownDisplay();
                return;
            }
            gasSendRemainingTime -= 1;
            if (gasSendRemainingTime < 0) {
                gasSendRemainingTime = 59;
            }
            updateCountdownDisplay();
        };
        gasSendCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay();
    }

    /**
     * 设置输入状态检测器，暂停/恢复计时器。
     */
    function setupTypingDetector() {
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, textarea, [contenteditable="true"]')) {
                isTyping = true; updateCountdownDisplay();
            }
        });
        document.addEventListener('focusout', (e) => {
            if (e.target.matches('input, textarea, [contenteditable="true"]')) {
                isTyping = false; updateCountdownDisplay();
            }
        });
    }

    /**
     * 创建脚本主浮窗UI。
     */
    function createUI() {
        GM_addStyle(`
            /* 主浮窗容器样式 */
            .ciaf-ui-container {
                position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: flex;
                flex-direction: column; gap: 8px; font-family: Arial, sans-serif;
                background-color: rgba(0, 0, 0, 0.7); color: white; border-radius: 8px;
                padding: 10px 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-size: 14px;
                line-height: 1.4; min-width: 200px; max-width: 250px; text-align: left;
            }
            .ciaf-ui-container div { margin-bottom: 3px; }
            #ciaf-quick-logs-display {
                word-break: break-all; font-size: 11px; white-space: pre-wrap;
                overflow-y: hidden; max-height: none; text-align: left !important; line-height: 1.3;
            }
            .ciaf-button {
                padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer;
                transition: background-color 0.2s; text-align: center; font-weight: bold;
                background-color: #007bff !important; color: white !important; opacity: 1 !important;
                pointer-events: auto !important; box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            }
            .ciaf-button:hover { filter: brightness(1.1); }
            #ciaf-refresh-btn { background-color: #28a745 !important; }
            #ciaf-refresh-btn:hover { background-color: #218838 !important; }
            #ciaf-settings-btn { background-color: #007bff !important; }
            #ciaf-settings-btn:hover { background-color: #0069d9 !important; }
            #ciaf-save-settings-btn { background-color: #28a745 !important; }
            #ciaf-save-settings-btn:hover { background-color: #218838 !important; }
            #ciaf-reset-settings-btn { background-color: #ffc107 !important; color: black !important; }
            #ciaf-reset-settings-btn:hover { background-color: #e0a800 !important; }
            #ciaf-test-notifications-btn { background-color: #6f42c1 !important; }
            #ciaf-test-notifications-btn:hover { background-color: #5a32a3 !important; }
            #ciaf-test-detector-btn { background-color: #dc3545 !important; }
            #ciaf-test-detector-btn:hover { background-color: #c82333 !important; }
            #ciaf-test-sheet-btn { background-color: #17a2b8 !important; }
            #ciaf-test-sheet-btn:hover { background-color: #138496 !important; }
            #ciaf-close-settings-btn {
                background: none !important; border: none !important; color: #888 !important;
                font-size: 24px !important; cursor: pointer !important; opacity: 1 !important;
                pointer-events: auto !important; position: absolute; top: 10px; right: 10px; line-height: 1;
            }
            .ciaf-settings-panel {
                display: none; position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%); width: 600px; height: 80vh;
                background: #f9f9f9; border: 1px solid #ccc; border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3); z-index: 10000; padding: 20px;
                color: #333; box-sizing: border-box; flex-direction: column;
            }
            .ciaf-settings-panel.visible { display: flex; }
            .ciaf-settings-panel h2 {
                margin-top: 0; text-align: center; color: #0056b3;
                margin-bottom: 15px; flex-shrink: 0;
            }
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            .form-group input[type="text"], .form-group input[type="number"] {
                width: calc(100% - 2px); padding: 8px; border-radius: 4px;
                border: 1px solid #ccc; box-sizing: border-box;
            }
            .checkbox-group label { display: inline-block; margin-right: 15px; font-weight: normal; }
            .ciaf-settings-tabs { display: flex; margin-bottom: 15px; border-bottom: 1px solid #eee; flex-shrink: 0; }
            .ciaf-settings-tab-button {
                padding: 10px 15px; cursor: pointer; background: #eee !important;
                border: 1px solid #ccc !important; border-bottom: none !important;
                border-top-left-radius: 5px !important; border-top-right-radius: 5px !important;
                margin-right: 5px; font-weight: bold; color: #333 !important;
                opacity: 1 !important; pointer-events: auto !important;
            }
            .ciaf-settings-tab-button.active {
                background: #f9f9f9 !important; border-color: #ccc !important;
                border-bottom-color: #f9f9f9 !important; color: #000 !important;
            }
            .ciaf-settings-tab-content {
                flex-grow: 1; overflow-y: auto; border: 1px solid #ccc;
                padding: 10px; border-radius: 5px; background: #fff;
                display: none; flex-direction: column;
            }
            .ciaf-settings-tab-content.active { display: flex; }
            .ciaf-tab-button-group {
                display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
                margin-top: auto; padding-top: 15px; border-top: 1px solid #eee; flex-shrink: 0;
            }
            .ciaf-test-buttons-section {
                display: grid; grid-template-columns: 1fr; gap: 10px;
                margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; flex-shrink: 0;
            }
            #ciaf-clear-log-btn { background-color: #dc3545 !important; }
            #ciaf-clear-log-btn:hover { background-color: #c82333 !important; }
            #ciaf-script-log-content {
                width: 100%; height: 100%; resize: vertical; border: none; background: #fff;
                font-family: monospace; font-size: 12px; white-space: pre-wrap;
            }
        `);
        const uiContainer = document.createElement('div');
        uiContainer.className = 'ciaf-ui-container';
        document.body.appendChild(uiContainer);

        const infoDisplayDiv = document.createElement('div');
        infoDisplayDiv.id = 'ciaf-info-display';
        uiContainer.appendChild(infoDisplayDiv);

        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'ciaf-refresh-btn';
        refreshBtn.className = 'ciaf-button';
        refreshBtn.textContent = '立即刷新';
        uiContainer.appendChild(refreshBtn);

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'ciaf-settings-btn';
        settingsBtn.className = 'ciaf-button';
        settingsBtn.innerHTML = '⚙️ 设置';
        uiContainer.appendChild(settingsBtn);

        refreshBtn.onclick = () => window.location.reload();
        settingsBtn.onclick = () => {
            const settingsPanel = document.getElementById('ciaf-settings-panel');
            settingsPanel.classList.toggle('visible');
            if (settingsPanel.classList.contains('visible')) {
                loadSettingsToPanel();
                showSettingsTab('settings');
                updateScriptLogDisplay();
            }
        };

        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'ciaf-settings-panel';
        settingsPanel.className = 'ciaf-settings-panel';
        document.body.appendChild(settingsPanel);
        buildSettingsPanelContent(settingsPanel);
    }

    /**
     * 手动构建设置面板所有内容并绑定事件。
     * @param {HTMLElement} panelElement - 设置面板的根DOM元素。
     */
    function buildSettingsPanelContent(panelElement) {
        panelElement.innerHTML = `
            <button id="ciaf-close-settings-btn">&times;</button>
            <h2>脚本设置</h2>
            <div class="ciaf-settings-tabs">
                <button id="ciaf-tab-button-settings" class="ciaf-settings-tab-button active">设置</button>
                <button id="ciaf-tab-button-log" class="ciaf-settings-tab-button">脚本日志</button>
            </div>

            <div id="ciaf-tab-content-settings" class="ciaf-settings-tab-content active">
                <div style="flex-grow: 1; overflow-y: auto;">
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
                <div class="ciaf-tab-button-group">
                    <button id="ciaf-save-settings-btn" class="ciaf-button">保存设置</button>
                    <button id="ciaf-reset-settings-btn" class="ciaf-button">恢复默认</button>
                </div>
                <div class="ciaf-test-buttons-section">
                     <button id="ciaf-test-notifications-btn" class="ciaf-button">① 测试通知功能</button>
                     <button id="ciaf-test-detector-btn" class="ciaf-button">② 触发消息探测</button>
                     <button id="ciaf-test-sheet-btn" class="ciaf-button">③ 测试/更新状态表</button>
                </div>
            </div>

            <div id="ciaf-tab-content-log" class="ciaf-settings-tab-content">
                 <textarea id="ciaf-script-log-content" readonly></textarea>
                 <div class="ciaf-tab-button-group" style="grid-template-columns: 1fr;">
                    <button id="ciaf-clear-log-btn" class="ciaf-button">清空日志</button>
                 </div>
            </div>
        `;

        // 绑定事件
        panelElement.querySelector('#ciaf-close-settings-btn').onclick = () => panelElement.classList.remove('visible');
        panelElement.querySelector('#ciaf-tab-button-settings').onclick = () => showSettingsTab('settings');
        panelElement.querySelector('#ciaf-tab-button-log').onclick = () => {
            showSettingsTab('log');
            updateScriptLogDisplay();
        };
        panelElement.querySelector('#ciaf-save-settings-btn').onclick = applySettingsFromPanel;
        panelElement.querySelector('#ciaf-reset-settings-btn').onclick = resetConfig;
        panelElement.querySelector('#ciaf-clear-log-btn').onclick = clearScriptLogs;

        panelElement.querySelector('#ciaf-test-notifications-btn').onclick = () => {
            if (confirm("即将直接测试通知功能。\n\n这会绕过探测器，用于快速检查声音、弹窗等是否工作。\n\n要继续吗？")) {
                sendMasterNotification(1, true);
            }
        };
        panelElement.querySelector('#ciaf-test-detector-btn').onclick = () => {
            if (!confirm("这是用于模拟消息变化的测试，会尝试修改页面上的消息数字。您确定要继续吗？")) return;
            try {
                const anchor = document.querySelector('a.show-messages[href="#New Job Notice Board"]');
                if (!anchor) throw new Error("无法找到消息面板的父级链接");
                const countSpan = anchor.querySelector("span[data-bind='text: messages().length']");
                if (!countSpan) throw new Error("无法找到消息计数元素");
                isDetectorTestActive = true;
                const currentCount = parseInt(countSpan.textContent, 10) || 0;
                const newCount = currentCount + 1;
                countSpan.textContent = newCount;
                GM_log(`消息探测测试：已将页面消息数从 ${currentCount} 修改为 ${newCount}。`);
                alert(`操作成功！\n\n已将页面消息数修改为 ${newCount}。\n\n如果探测器工作正常，您收到的通知（包括邮件）将被标记为测试。`);
            } catch (e) {
                isDetectorTestActive = false;
                alert(`消息探测测试失败: ${e.message}。请确保您在有“New Job Notice Board”的页面上。`);
                GM_log(`消息探测测试失败: ${e}`);
            }
        };
        panelElement.querySelector('#ciaf-test-sheet-btn').onclick = () => {
            if (confirm("即将向您的 Google Sheet 发送一次状态更新。\n\n这将创建或更新“脚本状态”工作表。您确定要继续吗？")) {
                sendRemoteStatus();
                alert("状态更新请求已发送！请检查您的 Google Sheet。");
            }
        };
    }


    /**
     * 显示指定设置面板Tab。
     * @param {string} tabId - 要显示的Tab ID ('settings', 'log')。
     */
    function showSettingsTab(tabId) {
        const panel = document.getElementById('ciaf-settings-panel');
        panel.querySelectorAll('.ciaf-settings-tab-content').forEach(tab => tab.classList.remove('active'));
        panel.querySelectorAll('.ciaf-settings-tab-button').forEach(btn => btn.classList.remove('active'));

        panel.querySelector(`#ciaf-tab-content-${tabId}`).classList.add('active');
        panel.querySelector(`#ciaf-tab-button-${tabId}`).classList.add('active');

        if (tabId === 'log') {
            const logContent = document.getElementById('ciaf-script-log-content');
            if (logContent) {
                logContent.scrollTop = logContent.scrollHeight;
            }
        }
    }

    /**
     * 保存当前内存中的日志到Tampermonkey持久化存储。
     */
    function saveScriptLogs() {
        try {
            GM_setValue(GM_STORAGE_LOG_KEY, JSON.stringify(scriptLogs));
        } catch (e) {
            originalGmLog("错误：保存日志到持久化存储失败！", e); // 使用原始log避免循环
        }
    }

    /**
     * 从Tampermonkey持久化存储加载日志到内存。
     */
    function loadScriptLogs() {
        const savedLogs = GM_getValue(GM_STORAGE_LOG_KEY, '[]');
        try {
            scriptLogs = JSON.parse(savedLogs);
            if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) {
                scriptLogs = scriptLogs.slice(scriptLogs.length - SCRIPT_LOGS_MAX_LINES);
            }
        } catch (e) {
            originalGmLog("加载日志失败或日志数据损坏，已清空日志。", e);
            scriptLogs = [];
        }
    }

    /**
     * 清空脚本日志（内存和持久化存储），并以正确的方式记录该操作。
     */
    function clearScriptLogs() {
        if (confirm("您确定要清空所有脚本日志吗？此操作不可撤销。")) {
            const timestamp = new Date().toLocaleTimeString();
            const clearMessage = `[${timestamp}] 脚本日志已清空。`;

            // 1. 直接将日志数组重置为只包含“已清空”消息
            scriptLogs = [clearMessage];

            // 2. 将这个“已清空”的状态持久化
            saveScriptLogs();

            // 3. 更新UI显示
            updateScriptLogDisplay();
            updateQuickLogDisplay();

            // 4. 只在浏览器控制台输出信息，不调用会触发循环的 GM_log
            originalGmLog("脚本日志已清空。");
        }
    }


    /**
     * 将当前配置的值加载到设置面板的输入框中。
     */
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

    /**
     * 应用设置面板中的值到配置并保存。
     */
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

    // =================================================================================
    // == [4] 长时间未更新提醒功能 (Idle Alert Feature)
    // =================================================================================

    function startIdleAlertChecker() {
        if (idleCheckIntervalId) {
            clearInterval(idleCheckIntervalId);
        }
        idleCheckIntervalId = setInterval(checkIdleStatus, 60 * 1000); // 每分钟检查一次
        GM_log("长时间未更新检查器已启动。");
    }

    function checkIdleStatus() {
        const thresholdMillis = config.idleAlertMinutes * 60 * 1000;
        const currentTime = Date.now();
        const timeSinceLastSend = currentTime - lastSuccessfulSendTimestamp;

        GM_log(`检查空闲状态。上次成功发送: ${new Date(lastSuccessfulSendTimestamp).toLocaleString()} (${Math.floor(timeSinceLastSend / (1000 * 60))} 分钟前)`);

        if (timeSinceLastSend > thresholdMillis && lastSuccessfulSendTimestamp !== 0) {
            GM_log(`⚠️ 警告：已长时间未更新状态！已超过 ${config.idleAlertMinutes} 分钟。`);
            GM_notification({
                title: `【提醒】Cat in a Flat 状态未更新！`,
                text: `您的脚本已超过 ${config.idleAlertMinutes} 分钟未成功发送状态到 Google Sheet。`,
                image: 'https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk',
                timeout: 0,
                onclick: () => { window.focus(); },
            });
            if (config.enableSound) playSound();
        }
    }

    // =================================================================================
    // == [5] 脚本启动逻辑 (Initialization Logic)
    // =================================================================================
    function main() {
        loadConfig();
        loadScriptLogs();

        window.addEventListener('beforeunload', saveScriptLogs);

        setTimeout(() => {
            const loginLink = document.querySelector('#login-link');
            if (loginLink) {
                GM_log("模式检测：发现 'Login' 链接，进入【掉线处理模式】。");
                const hasBeenNotified = GM_getValue('logout_notified', false);
                if (!hasBeenNotified) {
                    GM_log("正在发送掉线通知邮件...");
                    sendLogoutEmail();
                    GM_setValue('logout_notified', true);
                } else {
                    GM_log("已发送过掉线通知，本次不重复发送。");
                }
                return;
            }

            GM_log("模式检测：未发现 'Login' 链接，进入【在线监控模式】。");

            if (GM_getValue('logout_notified', false)) {
                GM_log("用户已确认登录，重置掉线通知标志。");
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
                        document.getElementById('ciaf-settings-panel').classList.remove('visible');

                        if (config.pauseWhileTyping) setupTypingDetector();
                        observeMessages(targetNode);
                        startPageRefreshTimer();

                        setInterval(sendRemoteStatus, 60000);
                        startGasSendCountdown();
                        GM_log("远程状态报告已启动（每60秒一次）。");

                        startIdleAlertChecker();
                    }
                }
            }, 1000);
        }, 3000);
    }

    main();

})();
