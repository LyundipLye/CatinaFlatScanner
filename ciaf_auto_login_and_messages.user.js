// ==UserScript==
// @name         Catinaflat Auto Login & Messages (Full Auto-Pilot)
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  v2.9: Adds email notification via GAS when a normal message is auto-clicked.
// @author       CaitLye & Gemini
// @match        *://*.catinaflat.co.uk/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        window.alert
// @grant        window.prompt
// ==/UserScript==

(function() {
    'use strict';

    // ========================= 【配置区域】 =========================
    // !!! 重要: 请将下面的URL替换为您自己的Google Apps Script部署URL
    // 如果留空，则不会发送邮件通知。
    const GAS_URL = "https://script.google.com/macros/s/AKfycbykkMpNw5TvgisICLy9O6w2FYOSZiDKfCFS0RTTHO_cr_TYnO-ZOYNAoBpZacqKYeTl/exec";
    // ===============================================================

    const STORE_EMAIL_KEY = 'catinaflat_email_b64';
    const STORE_PASSWORD_KEY = 'catinaflat_password_b64';
    const LOGIN_PAGE_URL = 'https://catinaflat.co.uk/login';

    function encodeBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
    function decodeBase64(str) { return decodeURIComponent(escape(atob(str))); }

    function waitForElement(selector, timeout = 15000) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 500);
        });
    }

    /**
     * v2.9 新增功能: 发送GAS邮件通知
     * @param {string} subject - 邮件主题
     * @param {string} message - 邮件内容
     */
    function sendGasRequest(subject, message) {
        return new Promise((resolve, reject) => {
            if (!GAS_URL) {
                console.log('[NOTIFICATION] GAS URL is not configured. Skipping email notification.');
                return resolve();
            }

            const payload = {
                subject: subject,
                message: message
            };

            console.log('[NOTIFICATION] Sending email notification...');
            GM_xmlhttpRequest({
                method: "POST",
                url: GAS_URL,
                headers: { "Content-Type": "text/plain;charset=UTF-8" },
                data: JSON.stringify(payload),
                onload: (response) => {
                    if (response.status === 200) {
                        console.log('[NOTIFICATION] Email sent successfully!');
                        resolve(response);
                    } else {
                        console.error('[NOTIFICATION] GAS request failed with status:', response.status);
                        reject(response);
                    }
                },
                onerror: (response) => {
                    console.error('[NOTIFICATION] GAS request error:', response);
                    reject(response);
                },
                ontimeout: () => {
                    console.error('[NOTIFICATION] GAS request timed out.');
                    reject();
                }
            });
        });
    }

    // 状态一：处理登录页面
    async function handleLoginPage() {
        console.log('[STATE] On Login Page. Filling form...');
        try {
            const email = decodeBase64(GM_getValue(STORE_EMAIL_KEY, ''));
            const password = decodeBase64(GM_getValue(STORE_PASSWORD_KEY, ''));
            if (!email || !password) return;

            const emailField = await waitForElement('#email');
            if (!emailField) throw new Error('Email field not found on login page.');

            const passwordField = document.querySelector('#password');
            const signInButton = document.querySelector('input[type="submit"].Btn--primary');
            if (!passwordField || !signInButton) throw new Error('Could not find form elements on login page.');

            emailField.value = email;
            passwordField.value = password;
            signInButton.click();
        } catch(error) {
            console.error('[ERROR] on login page:', error.message);
        }
    }

    // 状态二：处理已登录状态
    async function handleLoggedInState(messagesLink) {
        console.log('[STATE] Logged In.');
        const currentPagePath = window.location.pathname;

        const allUnreadLinks = document.querySelectorAll('a.BookingSummary--unread-sitter');
        let normalUnreadClicked = false;

        for (const link of allUnreadLinks) {
            const parentSection = link.closest('section.SectionFolder');
            if (parentSection) {
                const header = parentSection.querySelector('.SectionFolder-head h2');
                if (header && header.textContent.includes('Unread messages')) {
                    // v2.9 修改点: 发送邮件通知
                    try {
                        // 尝试提取发信人名字
                        const nameElement = link.querySelector('.BookingSummary-name');
                        const senderName = nameElement ? nameElement.textContent.trim() : 'Unknown Sender';

                        const subject = `【自动已读】来自 ${senderName} 的新消息`;
                        const message = `你好，\n\n自动脚本刚刚点击并已读了一条来自 "${senderName}" 的新消息。\n\n请尽快登录Cat in a Flat查看详情。\n\n时间: ${new Date().toLocaleString()}`;

                        await sendGasRequest(subject, message);

                    } catch(e) {
                        console.error("Failed to send notification email:", e);
                    }

                    console.log('[ACTION] Normal unread message found. Clicking it to clear...');
                    link.click();
                    normalUnreadClicked = true;
                    break;
                }
            }
        }

        if (normalUnreadClicked) {
            return;
        }

        const noticeBoardElement = document.querySelector('a.show-messages[href="#New Job Notice Board"]');
        if (noticeBoardElement) {
            console.log('[ACTION] Board element found. On correct page. Halting.');
            return;
        }

        if (currentPagePath.includes('/job-request/')) {
            console.log('[ACTION] On a job-request page. Halting to prevent loop.');
            return;
        }

        console.log(`[ACTION] Board not found. On a sub-page (${currentPagePath}). Redirecting...`);
        messagesLink.click();
    }

    // 状态三：处理未登录状态（在非登录页）
    function handleLoggedOutState() {
        console.log('[STATE] Logged Out on non-login page. Redirecting...');
        let email = GM_getValue(STORE_EMAIL_KEY);
        if (!email) {
            window.alert('First run: please enter your login credentials to be stored for auto-login.');
            email = window.prompt('Please enter your Catinaflat email address:');
            let password = email ? window.prompt('Please enter your Catinaflat password:') : null;
            if (email && password) {
                GM_setValue(STORE_EMAIL_KEY, encodeBase64(email));
                GM_setValue(STORE_PASSWORD_KEY, encodeBase64(password));
                window.location.href = LOGIN_PAGE_URL;
            }
        } else {
            window.location.href = LOGIN_PAGE_URL;
        }
    }

    // 主执行函数：负责判断状态并分发任务
    async function executeAutoPilot() {
        console.log('--- Auto-Pilot Script Started (Version 2.9) ---');
        await new Promise(resolve => setTimeout(resolve, 1500));

        if (window.location.pathname.startsWith('/login')) {
            await handleLoginPage();
            return;
        }

        const messagesLinkIfLoggedIn = await waitForElement('a.Masthead-userNavItemInner--messages[href*="/bookings"]');
        if (messagesLinkIfLoggedIn) {
            await handleLoggedInState(messagesLinkIfLoggedIn);
        } else {
            handleLoggedOutState();
        }

        console.log('--- Auto-Pilot Script Finished ---');
    }

    window.addEventListener('load', executeAutoPilot);

})();
