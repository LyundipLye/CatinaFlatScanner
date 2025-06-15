// ==UserScript==
// @name         Cat in a Flat UK Monitor
// @namespace    http://tampermonkey.net/
// @version      7.9.0
// @description  Cat in a Flat 网站监控脚本：增加运行日志上报至Google Sheet功能，并修复浮窗日志显示时序错误。
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
        minRefreshMinutes: 7, // 页面最小刷新间隔 (分钟)
        maxRefreshMinutes: 10, // 页面最大刷新间隔 (分钟)
        // Google Apps Script Web 应用的部署URL。请确保此URL是最新且有效的。
        googleScriptUrl: "https://script.google.com/macros/s/AKfycbxgLvGctjIGj-Vmx6zLquxc-5fsBu9ik4n_j6XNEFqI_BvfhggrpY7f668OssWbTF_D/exec",
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
    // 【修改点 1】将浮窗显示的日志数量从 3 改为 5
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
     * 更新浮窗和设置面板中的脚本日志显示。
     * 此函数必须在 GM_log 覆盖之前定义，以便 GM_log 能够调用它。
     */
    function updateScriptLogDisplay() {
        // 更新设置面板中的日志区域
        const logContent = document.getElementById('ciaf-script-log-content');
        if (logContent) {
            logContent.textContent = scriptLogs.join('\n');
            logContent.scrollTop = logContent.scrollHeight; // 滚动到底部
        }

        // 更新浮窗中的快速日志显示
        const quickLogsDiv = document.getElementById('ciaf-quick-logs');
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
        originalGmLog.apply(this, args); // 记录到浏览器控制台

        // 记录到内存数组
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

        // 限制日志行数
        if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) {
            scriptLogs.shift(); // 移除最旧的日志
        }
        updateScriptLogDisplay(); // 更新浮窗和设置面板日志显示
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
            // 如果配置无效，使用默认值
            return (DEFAULTS.minRefreshMinutes + Math.random() * (DEFAULTS.maxRefreshMinutes - DEFAULTS.minRefreshMinutes)) * 60 * 1000;
        }
        return (min + Math.random() * (max - min)) * 60 * 1000;
    }

    /**
     * 向Google Apps Script Web应用发送HTTP POST请求。
     * @param {object} data - 要发送的JSON数据。
     */
    function sendGoogleScriptRequest(data) {
        // 检查Apps Script URL是否配置正确
        if (!config.googleScriptUrl || !config.googleScriptUrl.startsWith("https://script.google.com/")) {
            GM_log("Google Apps Script URL 未配置或无效。");
            if (data.type === 'statusUpdate') {
                alert("Google Apps Script URL 未配置或无效，无法更新状态表。请在设置中检查。");
            }
            return;
        }
        GM_log(`正在向 GAS 发送请求到 URL: ${config.googleScriptUrl}`, data);
        GM_xmlhttpRequest({
            method: "POST",
            url: config.googleScriptUrl,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            data: JSON.stringify(data),
            onload: (response) => {
                GM_log(`GAS请求成功！状态码: ${response.status}，响应文本: ${response.responseText}`);
                if (response.status === 200 && response.responseText.includes("Success")) {
                    GM_log("GAS服务器报告成功处理请求。");
                    // 只有当是状态更新请求且成功时，才更新上次成功发送时间戳
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
            ontimeout: (response) => {
                GM_log(`GAS请求超时！`);
            },
            onabort: (response) => {
                GM_log(`GAS请求被中止！`);
            }
        });
    }

    /**
     * 发送远程状态更新到Google Sheet。
     */
    // 【修改点 2】修改此函数，使其发送状态的同时也发送日志
    function sendRemoteStatus() {
        // 计算页面刷新倒计时（格式化为MM:SS）
        const pageRefreshTotalSeconds = Math.max(0, Math.floor(pageRefreshRemainingTime / 1000));
        const pageRefreshMinutes = Math.floor(pageRefreshTotalSeconds / 60);
        const pageRefreshSeconds = pageRefreshTotalSeconds % 60;
        const formattedPageRefreshCountdown = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;

        // 从内存中获取最新的20条日志
        const recentLogs = scriptLogs.slice(Math.max(0, scriptLogs.length - 20));

        const statusData = {
            type: 'statusUpdate',
            countdown: formattedPageRefreshCountdown,
            messageCount: currentMessageCount,
            logs: recentLogs  // <-- 新增：将最近的日志打包进去
        };

        GM_log(`发送状态更新到GAS: 倒计时=${formattedPageRefreshCountdown}, 消息数=${currentMessageCount}, 日志条数=${recentLogs.length}`);
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

        // 使用MutationObserver持续监听消息数量变化
        const observer = new MutationObserver(handleCountCheck);
        observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
        setTimeout(handleCountCheck, 1500); // 首次检查，防止页面加载时消息已存在
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
    // 当窗口获得焦点时停止标题闪烁
    window.addEventListener('focus', stopTitleFlash);

    /**
     * 更新浮窗UI上的倒计时显示。
     */
    function updateCountdownDisplay() {
        const uiInfoDisplayDiv = document.getElementById('ciaf-info-display');
        if (!uiInfoDisplayDiv) return;

        // 页面刷新倒计时
        const pageRefreshMinutes = Math.floor(Math.max(0, pageRefreshRemainingTime) / 1000 / 60);
        const pageRefreshSeconds = Math.floor(Math.max(0, pageRefreshRemainingTime) / 1000 % 60);
        const formattedPageRefresh = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;

        // GAS 更新倒计时
        const gasSendMinutes = Math.floor(Math.max(0, gasSendRemainingTime) / 60);
        const gasSendSeconds = Math.floor(Math.max(0, gasSendRemainingTime) % 60);
        const formattedGasSend = `${String(gasSendMinutes).padStart(2, '0')}:${String(gasSendSeconds).padStart(2, '0')}`;

        // 上次成功发送时间
        const lastSendTime = lastSuccessfulSendTimestamp ? new Date(lastSuccessfulSendTimestamp).toLocaleTimeString() : 'N/A';

        // 输入中状态
        let typingStatus = '';
        if (isTyping && config.pauseWhileTyping) {
            typingStatus = ' (输入中)';
        }

        // 浮窗内容：使用 innerHTML 替换
        uiInfoDisplayDiv.innerHTML = `
            <div>猫猫监控🐱</div>
            <div><small>上次更新: ${lastSendTime}</small></div>
            <div>消息板: <span style="font-weight: bold; color: yellow;">${currentMessageCount}</span></div>
            <div>页面刷新: ${formattedPageRefresh}${typingStatus}</div>
            <div>GAS更新: ${formattedGasSend}</div>
            <div id="ciaf-quick-logs-display" style="font-size: 11px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 5px; text-align: left; /* 移除 max-height 和 overflow-y: auto; */">
            </div>
        `;
        updateQuickLogDisplay(); // 确保浮窗主要内容更新后立即更新日志
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
            const elapsed = now - lastTickTime; // 计算自上次tick以来实际经过的时间
            lastTickTime = now; // 更新上次tick时间

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
        pageRefreshCountdownIntervalId = setInterval(tick, 1000); // 仍然每秒触发，但内部计算更精确
        updateCountdownDisplay();
    }

    /**
     * 启动GAS发送倒计时。
     * 这是一个独立的倒计时，用于显示到下一次GAS更新还有多少秒。
     */
    function startGasSendCountdown() {
        if (gasSendCountdownIntervalId) clearInterval(gasSendCountdownIntervalId);
        gasSendRemainingTime = 60; // 首次启动或重置时设置为60秒
        const tick = () => {
            if (isTyping && config.pauseWhileTyping) {
                updateCountdownDisplay();
                return;
            }
            gasSendRemainingTime -= 1;
            if (gasSendRemainingTime < 0) {
                gasSendRemainingTime = 59; // 重置为下一分钟开始，因为sendRemoteStatus会立即发送
            }
            updateCountdownDisplay();
        };
        gasSendCountdownIntervalId = setInterval(tick, 1000);
        updateCountdownDisplay(); // 首次调用更新UI
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
        // 添加CSS样式
        GM_addStyle(`
            /* 主浮窗容器样式 */
            .ciaf-ui-container {
                position: fixed;
                bottom: 20px;
                left: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 8px;
                font-family: Arial, sans-serif;
                background-color: rgba(0, 0, 0, 0.7);
                color: white;
                border-radius: 8px;
                padding: 10px 15px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                font-size: 14px;
                line-height: 1.4;
                min-width: 200px;
                max-width: 250px;
                text-align: left;
            }
            .ciaf-ui-container div {
                margin-bottom: 3px;
            }
            /* 浮窗内日志区域样式 */
            #ciaf-quick-logs-display { /* Target the specific quick logs div */
                word-break: break-all; /* 强制单词内换行 */
                font-size: 11px;
                white-space: pre-wrap; /* 允许换行 */
                overflow-y: hidden; /* 隐藏滚动条 */
                max-height: none; /* 高度随内容动态调整 */
                text-align: left !important; /* 强制左对齐 */
                line-height: 1.3;
            }
            /* 强制按钮样式 */
            .ciaf-button {
                padding: 10px 15px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                transition: background-color 0.2s;
                text-align: center;
                font-weight: bold;
                background-color: #007bff !important;
                color: white !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            }
            .ciaf-button:hover {
                filter: brightness(1.1);
            }
            /* 特殊按钮颜色覆盖 */
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
                background: none !important; border: none !important;
                color: #888 !important; font-size: 24px !important;
                cursor: pointer !important; opacity: 1 !important;
                pointer-events: auto !important;
                position: absolute; top: 10px; right: 10px; line-height: 1;
            }


            /* 设置面板样式 */
            .ciaf-settings-panel {
                display: none;
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 600px;
                height: 80vh;
                background: #f9f9f9;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                z-index: 10000;
                padding: 20px;
                color: #333;
                box-sizing: border-box;
                flex-direction: column;
            }
            .ciaf-settings-panel.visible { display: flex; }
            .ciaf-settings-panel h2 {
                margin-top: 0;
                text-align: center;
                color: #0056b3;
                margin-bottom: 15px;
                flex-shrink: 0;
            }

            /* 通用表单组样式 */
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            .form-group input[type="text"], .form-group input[type="number"] {
                width: calc(100% - 2px);
                padding: 8px; border-radius: 4px; border: 1px solid #ccc; box-sizing: border-box;
            }
            .form-group input[type="number"] + span {
                margin: 0 5px;
            }
            .checkbox-group label { display: inline-block; margin-right: 15px; font-weight: normal; }

            /* Tab 导航样式 */
            .ciaf-settings-tabs { display: flex; margin-bottom: 15px; border-bottom: 1px solid #eee; flex-shrink: 0; }
            .ciaf-settings-tab-button {
                padding: 10px 15px;
                cursor: pointer;
                background: #eee !important;
                border: 1px solid #ccc !important;
                border-bottom: none !important;
                border-top-left-radius: 5px !important;
                border-top-right-radius: 5px !important;
                margin-right: 5px;
                font-weight: bold;
                color: #333 !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }
            .ciaf-settings-tab-button.active {
                background: #f9f9f9 !important;
                border-color: #ccc !important;
                border-bottom-color: #f9f9f9 !important;
                color: #000 !important;
            }

            /* Tab 内容区通用样式 */
            .ciaf-settings-tab-content {
                flex-grow: 1;
                overflow-y: auto;
                border: 1px solid #ccc;
                padding: 10px;
                border-radius: 5px;
                background: #fff;
                display: none;
                flex-direction: column;
            }
            .ciaf-settings-tab-content.active { display: flex; }

            /* 内部按钮组 */
            .ciaf-tab-button-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-top: auto;
                padding-top: 15px;
                border-top: 1px solid #eee;
                flex-shrink: 0;
            }
            /* 测试按钮部分 */
            .ciaf-test-buttons-section {
                 display: grid;
                 grid-template-columns: 1fr;
                 gap: 10px;
                 margin-top: 20px;
                 padding-top: 15px;
                 border-top: 1px solid #eee;
                 flex-shrink: 0;
            }
            /* 清空日志按钮样式 */
            #ciaf-clear-log-btn {
                background-color: #dc3545 !important;
            }
            #ciaf-clear-log-btn:hover {
                background-color: #c82333 !important;
            }


            /* 日志文本区域 */
            #ciaf-script-log-content {
                width: calc(100% - 0px);
                height: 100%;
                resize: vertical;
                border: none;
                background: #fff;
                font-family: monospace;
                font-size: 12px;
                white-space: pre-wrap;
            }
        `);
        // 创建主浮窗容器
        const uiContainer = document.createElement('div');
        uiContainer.className = 'ciaf-ui-container';
        uiContainer.id = 'ciaf-main-ui-container';
        document.body.appendChild(uiContainer);

        // 创建信息显示区域
        const infoDisplayDiv = document.createElement('div');
        infoDisplayDiv.id = 'ciaf-info-display';
        uiContainer.appendChild(infoDisplayDiv);

        // 添加按钮到主浮窗
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

        // 绑定主浮窗按钮事件
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

        // 创建设置面板元素
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'ciaf-settings-panel';
        settingsPanel.className = 'ciaf-settings-panel';
        document.body.appendChild(settingsPanel);

        // 填充设置面板内容并绑定事件 (手动构建DOM)
        buildSettingsPanelContent(settingsPanel);
    }

    /**
     * 手动构建设置面板所有内容并绑定事件。
     * @param {HTMLElement} panelElement - 设置面板的根DOM元素。
     */
    function buildSettingsPanelContent(panelElement) {
        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.id = 'ciaf-close-settings-btn';
        closeBtn.innerHTML = '&times;';
        panelElement.appendChild(closeBtn);
        closeBtn.onclick = () => panelElement.classList.remove('visible');

        // 标题
        const title = document.createElement('h2');
        title.textContent = '脚本设置';
        panelElement.appendChild(title);

        // Tabs 容器
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'ciaf-settings-tabs';
        panelElement.appendChild(tabsContainer);

        const createTabButton = (id, text, defaultActive = false) => {
            const button = document.createElement('button');
            button.id = `ciaf-tab-button-${id}`;
            button.className = `ciaf-settings-tab-button ${defaultActive ? 'active' : ''}`;
            button.textContent = text;
            tabsContainer.appendChild(button);
            return button;
        };

        const settingsTabBtn = createTabButton('settings', '设置', true);
        const logTabBtn = createTabButton('log', '脚本日志');

        // Tab 内容容器
        const createTabContent = (id, defaultActive = false) => {
            const contentDiv = document.createElement('div');
            contentDiv.id = `ciaf-tab-content-${id}`;
            contentDiv.className = `ciaf-settings-tab-content ${defaultActive ? 'active' : ''}`;
            panelElement.appendChild(contentDiv);
            return contentDiv;
        };

        const settingsContent = createTabContent('settings', true);
        const logContent = createTabContent('log');

        // === 填充设置 Tab 内容 (包含测试按钮) ===
        const settingsFormScrollDiv = document.createElement('div'); // 用于包裹设置表单项以便滚动
        settingsContent.appendChild(settingsFormScrollDiv);

        // 刷新间隔
        let formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        let label = document.createElement('label');
        label.setAttribute('for', 'ciaf-refresh-min');
        label.textContent = '刷新间隔 (分钟, 随机范围)';
        formGroup.appendChild(label);
        let flexDiv = document.createElement('div');
        flexDiv.style.display = 'flex';
        flexDiv.style.alignItems = 'center';
        flexDiv.style.gap = '10px';
        let inputMin = document.createElement('input');
        inputMin.type = 'number'; inputMin.id = 'ciaf-refresh-min'; inputMin.min = '1';
        flexDiv.appendChild(inputMin);
        let spanTo = document.createElement('span'); spanTo.textContent = '到';
        flexDiv.appendChild(spanTo);
        let inputMax = document.createElement('input');
        inputMax.type = 'number'; inputMax.id = 'ciaf-refresh-max'; inputMax.min = '1';
        flexDiv.appendChild(inputMax);
        formGroup.appendChild(flexDiv);
        settingsFormScrollDiv.appendChild(formGroup);

        // Google Apps Script URL
        formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        label = document.createElement('label');
        label.setAttribute('for', 'ciaf-google-url');
        label.textContent = 'Google Apps Script URL';
        formGroup.appendChild(label);
        let inputUrl = document.createElement('input');
        inputUrl.type = 'text'; inputUrl.id = 'ciaf-google-url'; inputUrl.placeholder = '粘贴你的URL';
        formGroup.appendChild(inputUrl);
        settingsFormScrollDiv.appendChild(formGroup);

        // 休眠提醒时间
        formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        label = document.createElement('label');
        label.setAttribute('for', 'ciaf-idle-alert-minutes');
        label.textContent = '休眠提醒时间 (分钟)';
        formGroup.appendChild(label);
        let inputIdle = document.createElement('input');
        inputIdle.type = 'number'; inputIdle.id = 'ciaf-idle-alert-minutes'; inputIdle.min = '5'; inputIdle.step = '5';
        formGroup.appendChild(inputIdle);
        settingsFormScrollDiv.appendChild(formGroup);

        // 通知类型
        formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        label = document.createElement('label');
        label.textContent = '通知类型';
        formGroup.appendChild(label);
        let checkboxGroup = document.createElement('div');
        checkboxGroup.className = 'checkbox-group';
        formGroup.appendChild(checkboxGroup);

        const createCheckbox = (id, text) => {
            let chkLabel = document.createElement('label');
            let input = document.createElement('input');
            input.type = 'checkbox'; input.id = id;
            chkLabel.appendChild(input);
            chkLabel.appendChild(document.createTextNode(` ${text}`));
            checkboxGroup.appendChild(chkLabel);
            return input; // 返回input元素以便后续加载值
        };
        const enableEmailChk = createCheckbox('ciaf-enable-email', '邮件');
        const enableSoundChk = createCheckbox('ciaf-enable-sound', '声音');
        const enablePopupChk = createCheckbox('ciaf-enable-popup', '弹窗');
        const enableTitleFlashChk = createCheckbox('ciaf-enable-titleflash', '标签闪烁');
        settingsFormScrollDiv.appendChild(formGroup);

        // 高级设置
        formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        label = document.createElement('label');
        label.textContent = '高级设置';
        formGroup.appendChild(label);
        checkboxGroup = document.createElement('div');
        checkboxGroup.className = 'checkbox-group';
        formGroup.appendChild(checkboxGroup);
        const pauseTypingChk = createCheckbox('ciaf-pause-typing', '输入时暂停刷新');
        settingsFormScrollDiv.appendChild(formGroup);

        // 保存/恢复按钮组
        const saveResetButtonGroup = document.createElement('div');
        saveResetButtonGroup.className = 'ciaf-tab-button-group';
        settingsContent.appendChild(saveResetButtonGroup);
        const saveBtn = document.createElement('button');
        saveBtn.id = 'ciaf-save-settings-btn'; saveBtn.className = 'ciaf-button'; saveBtn.textContent = '保存设置';
        saveResetButtonGroup.appendChild(saveBtn);
        const resetBtn = document.createElement('button');
        resetBtn.id = 'ciaf-reset-settings-btn'; resetBtn.className = 'ciaf-button'; resetBtn.textContent = '恢复默认';
        saveResetButtonGroup.appendChild(resetBtn);

        // === 填充测试按钮到设置Tab底部 ===
        const testsButtonGroup = document.createElement('div');
        testsButtonGroup.className = 'ciaf-test-buttons-section';
        settingsContent.appendChild(testsButtonGroup);

        const testNotificationsBtn = document.createElement('button');
        testNotificationsBtn.id = 'ciaf-test-notifications-btn'; testNotificationsBtn.className = 'ciaf-button'; testNotificationsBtn.textContent = '① 测试通知功能';
        testsButtonGroup.appendChild(testNotificationsBtn);

        const testDetectorBtn = document.createElement('button');
        testDetectorBtn.id = 'ciaf-test-detector-btn'; testDetectorBtn.className = 'ciaf-button'; testDetectorBtn.textContent = '② 触发消息探测';
        testsButtonGroup.appendChild(testDetectorBtn);

        const testSheetBtn = document.createElement('button');
        testSheetBtn.id = 'ciaf-test-sheet-btn'; testSheetBtn.className = 'ciaf-button'; testSheetBtn.textContent = '③ 测试/更新状态表';
        testsButtonGroup.appendChild(testSheetBtn);

        // === 填充脚本日志 Tab 内容 ===
        const scriptLogTextArea = document.createElement('textarea');
        scriptLogTextArea.id = 'ciaf-script-log-content';
        scriptLogTextArea.readOnly = true;
        logContent.appendChild(scriptLogTextArea);

        // 新增：清空日志按钮
        const clearLogBtn = document.createElement('button');
        clearLogBtn.id = 'ciaf-clear-log-btn';
        clearLogBtn.className = 'ciaf-button';
        clearLogBtn.textContent = '清空日志';
        logContent.appendChild(clearLogBtn);

        // === 绑定所有内部按钮事件 (确保在所有元素被创建并添加到DOM之后) ===
        saveBtn.onclick = applySettingsFromPanel;
        resetBtn.onclick = resetConfig;

        testNotificationsBtn.onclick = () => {
            if (confirm("即将直接测试通知功能。\n\n这会绕过探测器，用于快速检查声音、弹窗等是否工作。\n\n要继续吗？")) {
                sendMasterNotification(1, true);
            }
        };
        testDetectorBtn.onclick = () => {
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
        testSheetBtn.onclick = () => {
            if (confirm("即将向您的 Google Sheet 发送一次状态更新。\n\n这将创建或更新“脚本状态”工作表。您确定要继续吗？")) {
                sendRemoteStatus();
                alert("状态更新请求已发送！请检查您的 Google Sheet。");
            }
        };

        // 绑定Tab按钮事件 (在所有Tab内容创建后)
        settingsTabBtn.onclick = () => showSettingsTab('settings');
        logTabBtn.onclick = () => {
            showSettingsTab('log');
            updateScriptLogDisplay();
        };

        // 绑定清空日志按钮事件
        clearLogBtn.onclick = clearScriptLogs;
    }

    /**
     * 显示指定设置面板Tab。
     * @param {string} tabId - 要显示的Tab ID ('settings', 'log')。
     */
    function showSettingsTab(tabId) {
        const tabs = document.querySelectorAll('.ciaf-settings-tab-content');
        tabs.forEach(tab => tab.classList.remove('active'));
        const buttons = document.querySelectorAll('.ciaf-settings-tab-button');
        buttons.forEach(btn => btn.classList.remove('active'));

        document.getElementById(`ciaf-tab-content-${tabId}`).classList.add('active');
        document.getElementById(`ciaf-tab-button-${tabId}`).classList.add('active');

        // 如果是日志Tab，确保滚动到底部
        if (tabId === 'log') {
            const logContent = document.getElementById('ciaf-script-log-content');
            if (logContent) {
                logContent.scrollTop = logContent.scrollHeight;
            }
        }
    }

    /**
     * 更新脚本日志的UI显示。
     */
    function updateScriptLogDisplay() {
        const logContent = document.getElementById('ciaf-script-log-content');
        if (logContent) {
            logContent.textContent = scriptLogs.join('\n');
            logContent.scrollTop = logContent.scrollHeight; // 滚动到底部
        }
        // 由于updateQuickLogDisplay()现在独立调用，这里不再需要更新浮窗日志
    }

    /**
     * 更新浮窗中的快速日志显示。
     * 此函数独立于 updateCountdownDisplay() 调用，仅更新日志部分。
     */
    function updateQuickLogDisplay() {
        const quickLogsDiv = document.getElementById('ciaf-quick-logs-display');
        if (quickLogsDiv) {
            const recentLogsDisplay = scriptLogs.slice(Math.max(0, scriptLogs.length - QUICK_LOG_DISPLAY_COUNT))
                                              .map(log => escapeHtml(log))
                                              .join('<br>');
            quickLogsDiv.innerHTML = recentLogsDisplay;
            // 避免每次更新都重置滚动位置，因为我们已经移除了max-height和overflow-y:auto
            // 如果日志超出可见范围，浏览器会自动扩展浮窗高度
            // 如果仍想强制滚动，这里需要重新评估UI策略
        }
    }

    /**
     * 保存当前内存中的日志到Tampermonkey持久化存储。
     */
    function saveScriptLogs() {
        try {
            GM_setValue(GM_STORAGE_LOG_KEY, JSON.stringify(scriptLogs));
            // originalGmLog("日志已保存到持久化存储。"); // 不在此处记录，避免循环
        } catch (e) {
            originalGmLog("错误：保存日志到持久化存储失败！可能数据过大或存储限制。", e); // 使用原始log避免循环
        }
    }

    /**
     * 从Tampermonkey持久化存储加载日志到内存。
     */
    function loadScriptLogs() {
        const savedLogs = GM_getValue(GM_STORAGE_LOG_KEY, '[]');
        try {
            scriptLogs = JSON.parse(savedLogs);
            // 确保加载的日志不超过最大行数
            if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) {
                scriptLogs = scriptLogs.slice(scriptLogs.length - SCRIPT_LOGS_MAX_LINES);
            }
            // originalGmLog("已从持久化存储加载日志。"); // 不在此处记录，避免初始化日志过长
        } catch (e) {
            originalGmLog("加载日志失败或日志数据损坏，已清空日志。", e); // 使用原始log避免循环
            scriptLogs = [];
        }
    }

    /**
     * 清空脚本日志（内存和持久化存储）。
     */
    function clearScriptLogs() {
        if (confirm("您确定要清空所有脚本日志吗？此操作不可撤销。")) {
            scriptLogs = [];
            GM_setValue(GM_STORAGE_LOG_KEY, '[]'); // 清空持久化存储
            updateScriptLogDisplay(); // 更新设置面板UI显示
            updateQuickLogDisplay(); // 更新浮窗UI显示
            GM_log("脚本日志已清空。");
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
        startPageRefreshTimer(true); // 重新启动页面刷新计时器，应用新设置
        startGasSendCountdown(); // 重新启动GAS发送倒计时
        startIdleAlertChecker(); // 重新启动空闲提醒检查器
    }

    // =================================================================================
    // == [4] 长时间未更新提醒功能 (Idle Alert Feature)
    // =================================================================================

    /**
     * 启动定时检查，判断脚本是否长时间未更新。
     */
    function startIdleAlertChecker() {
        if (idleCheckIntervalId) {
            clearInterval(idleCheckIntervalId);
        }
        idleCheckIntervalId = setInterval(checkIdleStatus, 60 * 1000); // 每分钟检查一次
        GM_log("长时间未更新检查器已启动。");
    }

    /**
     * 检查脚本空闲状态并发送提醒。
     */
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
    /**
     * 脚本主入口点。
     */
    function main() {
        loadConfig(); // 加载配置
        loadScriptLogs(); // 加载持久化日志

        // 绑定页面卸载事件，确保在页面关闭/刷新前保存日志
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

            // 等待关键DOM元素加载
            const startupInterval = setInterval(() => {
                const anchor = document.querySelector('a.show-messages[href="#New Job Notice Board"]');
                if (anchor) {
                    const targetNode = anchor.querySelector('.SectionFolder-head--title.SectionFolder-head--underline');
                    if (targetNode) {
                        clearInterval(startupInterval); // 停止等待
                        GM_log(`成功找到目标面板，脚本完全启动 (v${GM_info.script.version})。`);
                        createUI(); // 创建浮窗UI
                        document.getElementById('ciaf-settings-panel').classList.remove('visible'); // 确保设置面板初始隐藏

                        if (config.pauseWhileTyping) setupTypingDetector(); // 设置输入状态检测
                        observeMessages(targetNode); // 启动消息数量监控
                        startPageRefreshTimer(); // 启动页面刷新计时器

                        setInterval(sendRemoteStatus, 60000); // 每60秒发送一次GAS状态报告
                        startGasSendCountdown(); // 启动GAS发送倒计时UI显示
                        GM_log("远程状态报告已启动（每60秒一次）。");

                        startIdleAlertChecker(); // 启动长时间未更新提醒检查器
                    }
                }
            }, 1000); // 每秒检查一次DOM元素
        }, 3000); // 延迟3秒启动主逻辑，等待页面充分加载
    }

    main(); // 调用主函数启动脚本

})();
