// ==UserScript==
// @name         Catinaflat Auto Login & Messages (Base64 Storage & Inbox Fix)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  智能判断登录状态并在正确页面点击消息链接，使用Base64编码存储密码，并且在inbox页面不跳转。
// @author       Caitlye
// @match        *://*.catinaflat.co.uk/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        window.alert
// @grant        window.prompt
// ==/UserScript==

(function() {
    'use strict';

    // 存储凭据的键名
    const STORE_EMAIL_KEY = 'catinaflat_email_b64';
    const STORE_PASSWORD_KEY = 'catinaflat_password_b64';

    // 目标页面路径的特征
    const MESSAGES_PATH_SEGMENT = '/bookings';
    const INBOX_PATH_SEGMENT = '/inbox/'; // 新增：单个消息页面的路径特征

    /**
     * 对字符串进行Base64编码。
     * @param {string} str
     * @returns {string} Base64编码后的字符串。
     */
    function encodeBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    /**
     * 对Base64编码的字符串进行解码。
     * @param {string} str
     * @returns {string} 解码后的字符串。
     */
    function decodeBase64(str) {
        return decodeURIComponent(escape(atob(str)));
    }

    /**
     * 辅助函数：等待指定选择器对应的元素出现。
     * @param {string} selector - 要等待的CSS选择器。
     * @param {number} [timeout=10000] - 等待超时时间（毫秒）。
     * @returns {Promise<Element|null>} - Promise 在元素找到时解析为该元素，超时则解析为 null。
     */
    function waitForElement(selector, timeout = 10000) {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                }
            }, 500);
            setTimeout(() => {
                clearInterval(interval);
                resolve(null);
            }, timeout);
        });
    }

    // 主执行函数
    async function executeAutoLoginAndMessages() {
        console.log('--- Script Started (Version 1.3) ---');

        // 【修改点】检查当前URL是否已经是目标消息页面或单个消息页，如果是，则不执行任何操作
        if (window.location.pathname.includes(MESSAGES_PATH_SEGMENT) || window.location.pathname.includes(INBOX_PATH_SEGMENT)) {
            console.log(`[INITIAL_CHECK] Already on a messages or inbox page (${window.location.pathname}). Script will not proceed.`);
            return;
        }

        let email = GM_getValue(STORE_EMAIL_KEY);
        let password = GM_getValue(STORE_PASSWORD_KEY);

        if (!email || !password) {
            window.alert('首次运行，需要您输入登录凭据。这些凭据将编码存储在您的浏览器中。');
            email = window.prompt('请输入您的 Catinaflat 邮箱地址:');
            if (email) {
                password = window.prompt('请输入您的 Catinaflat 密码:');
            }

            if (email && password) {
                GM_setValue(STORE_EMAIL_KEY, encodeBase64(email));
                GM_setValue(STORE_PASSWORD_KEY, encodeBase64(password));
                console.log('Credentials stored (Base64 encoded).');
            } else {
                console.error('Email or password not provided. Script cannot proceed.');
                return;
            }
        } else {
            email = decodeBase64(email);
            password = decodeBase64(password);
            console.log('Using stored credentials (Base64 decoded).');
        }

        // 检查是否已经登录（通过查找 Messages 链接）
        console.log('[STATE_CHECK] Checking if already logged in...');
        const messagesLinkIfLoggedIn = document.querySelector('a.Masthead-userNavItemInner--messages[href*="/bookings"]');

        if (messagesLinkIfLoggedIn) {
            console.log('[STATE_CHECK] Messages link found, assuming already logged in.');
            // 【修改点】再次确认不在消息或inbox页面才点击
             if (window.location.pathname.includes(MESSAGES_PATH_SEGMENT) || window.location.pathname.includes(INBOX_PATH_SEGMENT)) {
                 console.log(`[ACTION_CHECK] Already on target page (${window.location.pathname}). Not clicking.`);
                 return;
             }
            messagesLinkIfLoggedIn.click();
            console.log('[ACTION] Clicked the Messages link!');
            return;
        } else {
            console.log('[STATE_CHECK] Messages link not found, proceeding with login flow.');
        }

        // 如果未登录，则执行登录流程
        try {
            console.log('--- LOGIN_FLOW: Attempting to click Login link ---');
            const loginLink = document.querySelector('a#login-link') || document.querySelector('a[href*="/login"]');
            if (!loginLink) {
                throw new Error('Could not find the Login link.');
            }
            loginLink.click();
            console.log('[ACTION] Clicked the Login link!');

            console.log('[LOGIN_FLOW] Waiting for login form...');
            const emailField = await waitForElement('#email', 15000);
            if (!emailField) {
                throw new Error('Email input field not found.');
            }
            const passwordField = document.getElementById('password');
            const signInButton = document.querySelector('.Form-foot .Btn--secondary[type="submit"]');

            if (!passwordField || !signInButton) {
                throw new Error('Failed to find all login form elements.');
            }

            console.log('Login form elements detected. Filling form...');
            emailField.value = email;
            passwordField.value = password;
            emailField.dispatchEvent(new Event('input', { bubbles: true }));
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));

            console.log('Attempting to click Sign in...');
            signInButton.click();
            console.log('[ACTION] Sign in button clicked!');

            // 登录成功后，等待并点击“Messages”链接
            console.log('--- POST_LOGIN: Waiting for Messages link after login ---');
            const messagesLinkAfterLogin = await waitForElement('a.Masthead-userNavItemInner--messages[href*="/bookings"]', 25000);

            if (messagesLinkAfterLogin) {
                 // 【修改点】再次确认不在消息或inbox页面才点击
                if (window.location.pathname.includes(MESSAGES_PATH_SEGMENT) || window.location.pathname.includes(INBOX_PATH_SEGMENT)) {
                   console.log(`[POST_LOGIN_CHECK] Landed on target page after login (${window.location.pathname}). Not clicking.`);
                } else {
                   messagesLinkAfterLogin.click();
                   console.log('[ACTION] Successfully clicked the Messages link after login!');
                }
            } else {
                console.error('[POST_LOGIN] Failed to find Messages link after login.');
            }

        } catch (error) {
            console.error('[ERROR] Script encountered an error:', error.message);
            window.alert(`脚本执行出错：${error.message}`);
        }
        console.log('--- Script Finished ---');
    }

    window.addEventListener('load', executeAutoLoginAndMessages);
})();
