// ==UserScript==
// @name         Cat in a Flat UK Monitor (Silent Mode)
// @namespace    http://tampermonkey.net/
// @version      10.8
// @description  【v10.8 最终修复版】采用会话级变量重构故障警报逻辑，彻底修复了在某些情况下重复发送警报邮件的bug。
// @author       Gemini & CaitLye
// @match        *://catinaflat.co.uk/*
// @match        *://*.catinaflat.co.uk/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=catinaflat.co.uk
// @grant        GM_notification
// @grant        GM_log
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
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
        minCheckMinutes: 7,
        maxCheckMinutes: 10,
        googleScriptUrl: "https://script.google.com/macros/s/AKfycbykkMpNw5TvgisICLy9O6w2FYOSZiDKfCFS0RTTHO_cr_TYnO-ZOYNAoBpZacqKYeTl/exec",
        enableEmail: true,
        enableSound: true,
        enablePopup: true,
        enableTitleFlash: true,
        pauseWhileTyping: true,
        gasFailureAlertMinutes: 30,
    };

    let config = {};
    const SCRIPT_LOGS_MAX_LINES = 200;
    const GM_STORAGE_LOG_KEY = 'catScriptPersistentLogs';
    let scriptLogs = [];
    const QUICK_LOG_DISPLAY_COUNT = 3;

    // =================================================================================
    // == [2] 全局变量和状态 (Global Variables & State)
    // =================================================================================
    let titleFlashInterval = null;
    const originalTitle = document.title;
    let silentCheckIntervalId = null;
    let checkCountdownRemainingTime = 0;
    let lastTickTime = Date.now();
    let gasSendCountdownIntervalId = null;
    let gasSendRemainingTime = 60;
    let isTyping = false;
    let currentMessageCount = 'N/A';
    let lastSuccessfulSendTimestamp = GM_getValue('lastSuccessfulSendTimestamp_cat', 0);
    let lastHeartbeatCheckTimestamp = Date.now();
    let heartbeatIntervalId = null;
    let isTabStale = false;
    let gasFailureCheckIntervalId = null;
    let isChecking = false;
    let audioCtx;
    // v10.8 核心修改: 使用会话级变量代替GM存储来防止重复警报
    let hasSentFailureAlertThisSession = false;

    // =================================================================================
    // == [3] 核心功能函数 (Core Functions)
    // =================================================================================

    function escapeHtml(str) {
        if (!str) return '';
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
        let logMessage = args.map(arg => {
            if (arg instanceof Error) return arg.stack || arg.message;
            if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg, null, 2);
            return String(arg);
        }).join(' ');
        scriptLogs.push(`[${timestamp}] ${logMessage}`);
        if (scriptLogs.length > SCRIPT_LOGS_MAX_LINES) scriptLogs.shift();
        updateScriptLogDisplay();
    };

    function loadConfig() {
        const savedConfig = GM_getValue('catScriptConfig_v8', {});
        config = { ...DEFAULTS, ...savedConfig };
        GM_log("配置已加载: ", config);
    }

    function saveConfig() {
        GM_setValue('catScriptConfig_v8', config);
        alert("设置已保存！部分设置将在下次手动重置计时器后生效。");
        GM_log("配置已保存: ", config);
    }

    function resetConfig() {
        if (confirm("您确定要将所有设置重置为默认值吗？")) {
            config = { ...DEFAULTS };
            GM_setValue('catScriptConfig_v8', {});
            alert("设置已重置为默认值，页面将刷新以应用。");
            location.reload();
        }
    }

    function processNewMessageCount(newCount, isTest = false) {
        if (isNaN(newCount)) {
            GM_log("❌ 处理消息数失败: 无效的数字。");
            return;
        }
        GM_log(`⚙️ 正在处理消息数: ${newCount}`);
        currentMessageCount = newCount;
        // v10.8: 抓取成功后，重置会话级警报标记
        if (hasSentFailureAlertThisSession) {
            GM_log("✅ 抓取功能已恢复，重置本会话的失败警报标记。");
            hasSentFailureAlertThisSession = false;
        }
        let lastMessageCount = GM_getValue('lastMessageCount_uk', 0);
        if (newCount > lastMessageCount) {
            GM_log(`🚀 ${isTest ? '【模拟】' : ''}探测到新消息！从 ${lastMessageCount} 条变为 ${newCount} 条。`);
            sendMasterNotification(newCount, isTest);
            if (!isTest) {
                GM_setValue('lastMessageCount_uk', newCount);
            }
        } else if (newCount < lastMessageCount && !isTest) {
            GM_log(`消息数减少。从 ${lastMessageCount} 条变为 ${newCount} 条。同步更新。`);
            GM_setValue('lastMessageCount_uk', newCount);
        } else if (!isTest) {
            GM_log("消息数量无变化。");
        }
    }

    function updateTestStatus(message, color, clearAfter = 0) {
        const statusDiv = document.getElementById('ciaf-test-status');
        if (statusDiv) {
            statusDiv.style.color = color;
            statusDiv.innerHTML = message;
            if (clearAfter > 0) {
                setTimeout(() => { if (statusDiv.innerHTML === message) statusDiv.innerHTML = ''; }, clearAfter);
            }
        }
    }

    /**
     * v10.8 核心修改: 使用会话级变量
     */
    function handleFetchFailure(reason) {
        GM_log(`❌ 后台检查失败: ${reason}`);
        if (!hasSentFailureAlertThisSession) {
            GM_log("🚨 首次检测到抓取失败，准备发送警报邮件...");
            updateTestStatus("🚨 检测到抓取失败！正在发送警报邮件...", 'orange');
            const emailData = {
                subject: "【严重警告】监控脚本抓取失败！",
                message: `你好，\n\n您的 Cat in a Flat 监控脚本在后台进行无痕检查时，未能成功抓取到消息数量。\n\n失败原因: ${reason}\n\n这很可能意味着网站的前端结构发生了改变，导致脚本无法定位元素。请尽快检查脚本和网站状况。\n\n为了避免邮件轰炸，在问题解决前，此邮件将只发送一次。\n\n时间: ${new Date().toLocaleString()}`
            };
            sendGoogleScriptRequest(emailData, true);
            hasSentFailureAlertThisSession = true;
            GM_log("🚨 已设置本会话的失败警报标记。");
        } else {
            GM_log("🚨 已发送过抓取失败警报，本次不再重复发送。");
        }
    }

    function sendGoogleScriptRequest(data, isFailureAlert = false) {
        if (!config.googleScriptUrl || !config.googleScriptUrl.startsWith("https://script.google.com/")) {
            GM_log("Google Apps Script URL 未配置或无效。");
            if (isFailureAlert) updateTestStatus("❌ <b>警报邮件发送失败:</b> GAS URL 未配置。", 'red');
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
                    if (isFailureAlert) {
                        updateTestStatus("✅ <b>故障警报邮件</b> 已成功发送至服务器。", 'green', 15000);
                    }
                } else {
                    if (isFailureAlert) {
                        updateTestStatus(`❌ <b>故障警报邮件</b> 发送失败！<br>服务器响应: ${response.status}`, 'red');
                    }
                }
            },
            onerror: (response) => {
                GM_log(`GAS请求网络错误:`, response);
                if (isFailureAlert) updateTestStatus("❌ <b>故障警报邮件</b> 发送失败！<br>网络错误。", 'red');
            },
            ontimeout: () => {
                GM_log(`GAS请求超时！`);
                if (isFailureAlert) updateTestStatus("❌ <b>故障警报邮件</b> 发送失败！<br>请求超时。", 'red');
            },
            onabort: () => {
                GM_log(`GAS请求被中止！`);
                if (isFailureAlert) updateTestStatus("❌ <b>故障警报邮件</b> 发送失败！<br>请求被中止。", 'red');
            }
        });
    }

    function performSilentCheck() {
        if (isChecking) {
            GM_log("🤫 上次检查仍在进行中，跳过本次。");
            return;
        }
        isChecking = true;
        GM_log("🤫 开始执行 '画中画' 无痕后台检查 (v10.8)...");

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';

        const cleanup = () => {
            clearTimeout(outerTimeoutId);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            isChecking = false;
        };

        const outerTimeoutId = setTimeout(() => {
            handleFetchFailure("后台检查总超时（45秒）。");
            cleanup();
        }, 45000);

        iframe.onload = function() {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc) throw new Error("无法访问iFrame文档。");

                let pollInterval;
                const pollTimeout = 20000;
                const pollStartTime = Date.now();

                pollInterval = setInterval(() => {
                    const countSpan = doc.querySelector("a.show-messages[href='#New Job Notice Board'] span[data-bind='text: messages().length']");

                    if (countSpan) {
                        clearInterval(pollInterval);
                        const newCount = parseInt(countSpan.textContent, 10);
                        processNewMessageCount(newCount, false);
                        cleanup();
                    } else if (Date.now() - pollStartTime > pollTimeout) {
                        clearInterval(pollInterval);
                        let reason = "在iFrame内等待元素超时(20秒)，可能是网站结构已改变。";
                        if (doc.querySelector('#login-link')) {
                            reason = "检测到掉线！准备刷新页面重新登录。";
                            if (!GM_getValue('logout_notified', false)) {
                                sendLogoutEmail();
                                GM_setValue('logout_notified', true);
                            }
                            setTimeout(() => window.location.reload(), 5000);
                        }
                        handleFetchFailure(reason);
                        cleanup();
                    }
                }, 500);

            } catch (error) {
                handleFetchFailure(`处理iFrame内容时出错: ${error.message}`);
                cleanup();
            }
        };

        iframe.onerror = function() {
            handleFetchFailure("iFrame加载失败，可能是网络或跨域问题。");
            cleanup();
        };

        iframe.src = window.location.href;
        document.body.appendChild(iframe);
    }

    function getRandomCheckInterval() {
        const min = parseFloat(config.minCheckMinutes);
        const max = parseFloat(config.maxCheckMinutes);
        if (isNaN(min) || isNaN(max) || min > max) {
            return (DEFAULTS.minCheckMinutes + Math.random() * (DEFAULTS.maxCheckMinutes - DEFAULTS.minCheckMinutes)) * 60 * 1000;
        }
        return (min + Math.random() * (max - min)) * 60 * 1000;
    }

    function startSilentCheckLoop(isManualReset = false) {
        if (silentCheckIntervalId) clearInterval(silentCheckIntervalId);

        if (!isManualReset) {
           performSilentCheck();
        }

        const mainLoop = () => {
            checkCountdownRemainingTime = getRandomCheckInterval();
            GM_log(`下一次后台检查将在 ${Math.round(checkCountdownRemainingTime / 60000)} 分钟后进行。`);
            lastTickTime = Date.now();

            const tick = () => {
                const now = Date.now();
                const elapsed = now - lastTickTime;
                lastTickTime = now;
                if (!(isTyping && config.pauseWhileTyping)) {
                    checkCountdownRemainingTime -= elapsed;
                }
                updateCountdownDisplay();
                if (checkCountdownRemainingTime <= 0) {
                    clearInterval(silentCheckIntervalId);
                    performSilentCheck();
                    mainLoop();
                }
            };
            silentCheckIntervalId = setInterval(tick, 1000);
        };
        mainLoop();
    }

    function sendRemoteStatus() {
        if (currentMessageCount === 'N/A') {
            GM_log("由于消息数未知，跳过本次GAS状态更新。");
            return;
        }
        const pageRefreshTotalSeconds = Math.max(0, Math.floor(checkCountdownRemainingTime / 1000));
        const pageRefreshMinutes = Math.floor(pageRefreshTotalSeconds / 60);
        const pageRefreshSeconds = pageRefreshTotalSeconds % 60;
        const formattedPageRefreshCountdown = `${String(pageRefreshMinutes).padStart(2, '0')}:${String(pageRefreshSeconds).padStart(2, '0')}`;
        const statusData = {
            type: 'statusUpdate',
            countdown: formattedPageRefreshCountdown,
            messageCount: currentMessageCount,
        };
        sendGoogleScriptRequest(statusData, false);
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

    function initAudioContext() {
        if (audioCtx && audioCtx.state !== 'closed') return;
        try {
            audioCtx = new(window.AudioContext || window.webkitAudioContext)();
            GM_log("音频上下文已初始化。");
        } catch (e) {
            GM_log("❌ 无法初始化音频上下文:", e);
        }
    }

    function _doPlaySound() {
        if (!audioCtx) {
            GM_log("⚠️ 音频上下文不可用，无法播放声音。");
            return;
        }
        try {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.5);
        } catch (e) {
            GM_log("❌ 播放提示音时出错:", e);
        }
    }

    function playSound() {
        if (!config.enableSound) return;
        if (!audioCtx) {
             GM_log("⚠️ 声音播放失败：音频上下文未由用户手势激活。");
             return;
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                GM_log("音频上下文已恢复，正在播放声音。");
                _doPlaySound();
            });
        } else {
            _doPlaySound();
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

        const checkMinutes = Math.floor(Math.max(0, checkCountdownRemainingTime) / 1000 / 60);
        const checkSeconds = Math.floor(Math.max(0, checkCountdownRemainingTime) / 1000 % 60);
        const formattedCheckCountdown = `${String(checkMinutes).padStart(2, '0')}:${String(checkSeconds).padStart(2, '0')}`;

        const gasSendMinutes = Math.floor(Math.max(0, gasSendRemainingTime) / 60);
        const gasSendSeconds = Math.floor(Math.max(0, gasSendRemainingTime) % 60);
        const formattedGasSend = `${String(gasSendMinutes).padStart(2, '0')}:${String(gasSendSeconds).padStart(2, '0')}`;

        const lastSendTime = lastSuccessfulSendTimestamp ? new Date(lastSuccessfulSendTimestamp).toLocaleTimeString() : 'N/A';
        const typingStatus = (isTyping && config.pauseWhileTyping) ? ' (输入中)' : '';
        const heartbeatStatus = isTabStale ? '<div style="color: orange; font-weight: bold; text-align: center;">⚠️ 刚从休眠中唤醒</div>' : '';

        uiInfoDisplayDiv.innerHTML = `
            ${heartbeatStatus}
            <div>无痕监控模式 🤫 <span style="font-size: 10px;">v${GM_info.script.version}</span></div>
            <div><small>上次GAS同步: ${lastSendTime}</small></div>
            <div>消息板: <span style="font-weight: bold; color: yellow;">${currentMessageCount}</span></div>
            <div>下次后台检查: ${formattedCheckCountdown}${typingStatus}</div>
            <div>GAS更新倒数: ${formattedGasSend}</div>
        `;
    }

    function updateQuickLogDisplay() {
        const quickLogsDiv = document.getElementById('ciaf-quick-logs');
        if (quickLogsDiv) {
            const recentLogsDisplay = scriptLogs.slice(-QUICK_LOG_DISPLAY_COUNT).map(log => escapeHtml(log)).join('<br>');
            quickLogsDiv.innerHTML = recentLogsDisplay;
        }
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

    function startTabHeartbeatMonitor() {
        if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
        const checkInterval = 60 * 1000;
        const staleThreshold = 60 * 5000;
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
                sendRemoteStatus();
                setTimeout(() => { isTabStale = false; }, 15000);
            }
            lastHeartbeatCheckTimestamp = now;
            updateCountdownDisplay();
        }, checkInterval);
        GM_log("💓 标签页心跳检测器已启动。");
    }

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

    function testElementDiscovery() {
        const testBtn = document.getElementById('ciaf-test-discovery-btn');
        if (isChecking) {
            updateTestStatus("一个检查已在进行中，请稍后再试。", 'orange');
            return;
        }
        isChecking = true;

        testBtn.textContent = "测试中...";
        testBtn.disabled = true;

        updateTestStatus("[1/4] 开始执行...", 'blue');

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';

        const cleanup = (resultMsg, isSuccess) => {
            updateTestStatus(`[4/4] ${resultMsg}`, isSuccess ? 'green' : 'red', 15000);
            clearTimeout(outerTimeoutId);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            isChecking = false;

            testBtn.textContent = "① 测试抓取";
            testBtn.disabled = false;
        };

        const outerTimeoutId = setTimeout(() => {
            cleanup("❌ <b>测试失败：</b>总操作超时(45秒)。", false);
        }, 45000);

        iframe.onload = function() {
            try {
                updateTestStatus("[2/4] iFrame已加载，开始轮询等待...", 'blue');
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc) throw new Error("无法访问iFrame文档。");

                let pollInterval;
                const pollTimeout = 20000;
                const pollStartTime = Date.now();

                pollInterval = setInterval(() => {
                    const elapsed = Math.round((Date.now() - pollStartTime) / 1000);
                    updateTestStatus(`[3/4] 轮询中 (已过 ${elapsed} 秒)...`, 'blue');

                    const countSpan = doc.querySelector("a.show-messages[href='#New Job Notice Board'] span[data-bind='text: messages().length']");
                    if (countSpan) {
                        clearInterval(pollInterval);
                        const count = countSpan.textContent.trim();
                        cleanup(`✅ <b>抓取成功！</b> 已找到元素，值为: ${count}`, true);
                    } else if (Date.now() - pollStartTime > pollTimeout) {
                        clearInterval(pollInterval);
                        let reason = "未知原因。可能是网站结构已改变。";
                        if(doc.querySelector('#login-link')) {
                            reason = "您当前处于掉线状态。";
                        }
                        cleanup(`❌ <b>抓取失败！</b> 未能找到元素。<br>原因: ${reason}`, false);
                    }
                }, 1000);
            } catch (error) {
                cleanup(`❌ <b>测试时发生错误:</b> ${error.message}`, false);
            }
        };
        iframe.onerror = () => cleanup("❌ <b>测试失败：</b>iFrame加载错误。", false);

        updateTestStatus("[1/4] 正在创建并加载隐形iFrame...", 'blue');
        iframe.src = window.location.href;
        document.body.appendChild(iframe);
    }

    function createUI() {
        GM_addStyle(`
            .ciaf-ui-container { position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; font-family: Arial, sans-serif; background-color: rgba(0, 0, 0, 0.7); color: white; border-radius: 8px; padding: 10px 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-size: 14px; line-height: 1.4; min-width: 220px; text-align: left; }
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
            #ciaf-test-status { text-align: center; margin-top: 15px; font-weight: bold; min-height: 40px; line-height: 1.4; transition: color 0.3s; }
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
                <button id="ciaf-refresh-btn" class="ciaf-button">立即检查</button>
                <button id="ciaf-settings-btn" class="ciaf-button">⚙️ 设置</button>
            </div>
        `;
        document.body.appendChild(uiContainer);

        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'ciaf-settings-panel';
        settingsPanel.className = 'ciaf-settings-panel';
        document.body.appendChild(settingsPanel);

        buildSettingsPanelContent(settingsPanel);

        document.getElementById('ciaf-refresh-btn').onclick = () => {
            GM_log("手动触发后台检查...");
            performSilentCheck();
        };
        document.getElementById('ciaf-settings-btn').onclick = () => {
            document.getElementById('ciaf-settings-panel').classList.add('visible');
            loadSettingsToPanel();
            showSettingsTab('settings');
            updateScriptLogDisplay();
        };
    }

    function buildSettingsPanelContent(panel) {
        panel.innerHTML = `
            <button id="ciaf-close-settings-btn">&times;</button>
            <h2>脚本设置 (无痕模式)</h2>
            <div class="ciaf-settings-tabs">
                <button id="ciaf-tab-button-settings" class="ciaf-settings-tab-button active">通用设置</button>
                <button id="ciaf-tab-button-log" class="ciaf-settings-tab-button">脚本日志</button>
            </div>

            <div id="ciaf-tab-content-settings" class="ciaf-settings-tab-content active">
                <div style="flex-grow:1; overflow-y:auto; padding-right:10px;">
                    <div class="form-group">
                        <label>后台检查间隔 (分钟, 随机范围)</label>
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
                        <label><input type="checkbox" id="ciaf-pause-typing"> 输入时暂停计时</label>
                    </div>
                    <div class="ciaf-test-buttons-section">
                        <button id="ciaf-test-discovery-btn" class="ciaf-button" style="background-color:#dc3545 !important;">① 测试抓取</button>
                        <button id="ciaf-test-simulation-btn" class="ciaf-button" style="background-color:#6f42c1 !important;">② 模拟通知</button>
                        <button id="ciaf-test-sheet-btn" class="ciaf-button" style="background-color:#17a2b8 !important;">③ 更新状态表</button>
                    </div>
                    <div id="ciaf-test-status"></div>
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

        panel.querySelector('#ciaf-test-discovery-btn').onclick = testElementDiscovery;

        panel.querySelector('#ciaf-test-simulation-btn').onclick = () => {
            GM_log("② 开始模拟通知 (根部模拟)...");
            try {
                const lastMessageCount = GM_getValue('lastMessageCount_uk', 0);
                const simulatedNewCount = lastMessageCount + 1;
                GM_log(`模拟数据: 上次消息数=${lastMessageCount}, 模拟新消息数=${simulatedNewCount}`);
                processNewMessageCount(simulatedNewCount, true);
                updateTestStatus(`✅ <b>模拟通知成功！</b> 已触发一个【测试】通知流程。`, 'green', 10000);
            } catch (e) {
                GM_log("❌ 模拟通知失败:", e);
                updateTestStatus(`❌ <b>模拟通知失败:</b> ${e.message}`, 'red');
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
        document.getElementById('ciaf-refresh-min').value = config.minCheckMinutes;
        document.getElementById('ciaf-refresh-max').value = config.maxCheckMinutes;
        document.getElementById('ciaf-google-url').value = config.googleScriptUrl;
        document.getElementById('ciaf-gas-failure-minutes').value = config.gasFailureAlertMinutes;
        document.getElementById('ciaf-enable-email').checked = config.enableEmail;
        document.getElementById('ciaf-enable-sound').checked = config.enableSound;
        document.getElementById('ciaf-enable-popup').checked = config.enablePopup;
        document.getElementById('ciaf-enable-titleflash').checked = config.enableTitleFlash;
        document.getElementById('ciaf-pause-typing').checked = config.pauseWhileTyping;
    }

    function applySettingsFromPanel() {
        config.minCheckMinutes = document.getElementById('ciaf-refresh-min').value;
        config.maxCheckMinutes = document.getElementById('ciaf-refresh-max').value;
        config.googleScriptUrl = document.getElementById('ciaf-google-url').value.trim();
        config.gasFailureAlertMinutes = parseFloat(document.getElementById('ciaf-gas-failure-minutes').value);
        config.enableEmail = document.getElementById('ciaf-enable-email').checked;
        config.enableSound = document.getElementById('ciaf-enable-sound').checked;
        config.enablePopup = document.getElementById('ciaf-enable-popup').checked;
        config.enableTitleFlash = document.getElementById('ciaf-enable-titleflash').checked;
        config.pauseWhileTyping = document.getElementById('ciaf-pause-typing').checked;

        saveConfig();
        document.getElementById('ciaf-settings-panel').classList.remove('visible');

        startSilentCheckLoop(true);
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
        // v10.6 核心修复: 移除错误的flag重置逻辑
        // GM_deleteValue('fetch_failure_alert_sent');
        window.addEventListener('beforeunload', saveScriptLogs);

        setTimeout(() => {
            GM_log("模式检测：进入【无痕监控模式】。");
            createUI();

            if (config.pauseWhileTyping) setupTypingDetector();

            startSilentCheckLoop();

            setInterval(sendRemoteStatus, 60000);
            startGasSendCountdown();
            startTabHeartbeatMonitor();
            startGasFailureChecker();

            document.body.addEventListener('click', initAudioContext, { once: true });
            document.body.addEventListener('keydown', initAudioContext, { once: true });
        }, 2000);
    }

    main();

})();
