// ==UserScript==
// @name         Catinaflat Auto Login & Messages (Full Auto-Pilot)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Final version with hybrid logic. Uses URL-based detection overridden by element presence to prevent refresh loops.
// @author       CaitLye & Gemini
// @match        *://*.catinaflat.co.uk/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        window.alert
// @grant        window.prompt
// ==/UserScript==

(function() {
    'use strict';

    const STORE_EMAIL_KEY = 'catinaflat_email_b64';
    const STORE_PASSWORD_KEY = 'catinaflat_password_b64';
    const LOGIN_PAGE_URL = 'https://catinaflat.co.uk/login';

    function encodeBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
    function decodeBase64(str) { return decodeURIComponent(escape(atob(str))); }

    function waitForElement(selector, timeout = 5000) {
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

    async function executeAutoPilot() {
        console.log('--- Auto-Pilot Script Started (Version 2.4) ---');
        await new Promise(resolve => setTimeout(resolve, 1500));

        const currentPagePath = window.location.pathname;

        // 1. 如果在登录页面，则执行登录
        if (currentPagePath.startsWith('/login')) {
            console.log('[STATE_CHECK] On the login page. Filling form...');
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
            return;
        }

        // 2. 检查是否已登录
        const messagesLinkIfLoggedIn = await waitForElement('a.Masthead-userNavItemInner--messages[href*="/bookings"]');

        if (messagesLinkIfLoggedIn) {
            console.log('[STATE_CHECK] User is logged in.');

            // 优先级1: 检查并处理看板上的未读消息列表
            const unreadMessageLink = document.querySelector('a.BookingSummary--unread-sitter');
            if (unreadMessageLink) {
                console.log('[ACTION_UNREAD] Unread message list item found. Clicking it...');
                unreadMessageLink.click();
                return; // 点击后即完成本次任务
            }

            // ========================= 【最终混合逻辑】 =========================
            // 优先级2: 检查是否在可能需要跳转的子页面
            const isPotentialSubPage = currentPagePath.includes('/users/') || currentPagePath.includes('/edit/') || currentPagePath.includes('/inbox/');

            if (isPotentialSubPage) {
                console.log(`[REDIRECT_CHECK] URL (${currentPagePath}) matches sub-page pattern.`);

                // 覆盖检查(Override Check): 在决定跳转前，最后检查一次看板元素是否存在
                const noticeBoardElement = document.querySelector('a.show-messages[href="#New Job Notice Board"]');

                if (noticeBoardElement) {
                    // 看板存在，说明这就是主页面，必须停止操作，否则会无限循环
                    console.log('[OVERRIDE] Board element found. This is the correct page. Halting to prevent refresh loop.');
                } else {
                    // 看板不存在，说明这确实是需要返回的子页面（如/inbox/）
                    console.log('[ACTION_REDIRECT] Board element NOT found. Redirecting back to main board.');
                    messagesLinkIfLoggedIn.click();
                }
            } else {
                 console.log(`[ACTION_CHECK] URL (${currentPagePath}) does not match sub-page pattern. No action needed.`);
            }
            // =================================================================

            console.log('--- Script Finished: Logged-in state handled. ---');
            return;
        }

        // 3. 如果未登录且不在登录页，则导航到登录页
        console.log('[STATE_CHECK] User not logged in. Redirecting to login page.');
        let email = GM_getValue(STORE_EMAIL_KEY);
        if (!email) {
            window.alert('First run: please enter your login credentials. You will then be redirected to the login page.');
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

    window.addEventListener('load', executeAutoPilot);

})();
