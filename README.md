=====================================================
Cat in a Flat Scanner & Notifier Project
Cat in a Flat 扫描与通知器项目
=====================================================

INTRODUCTION
简介

This project contains a powerful set of user scripts designed to monitor the "New Job Notice Board" on the Cat in a Flat UK website. The scripts work together to automate the login process and provide instant, multi-channel alerts for new jobs.
本项目包含一套功能强大的用户脚本，专门用于监控 Cat in a Flat 英国站点的 "New Job Notice Board"。这些脚本协同工作，以实现自动登录，并在有新消息时通过多种渠道向您发送即时提醒。

-----------------------------------------------------
SCRIPTS INCLUDED
包含的脚本
-----------------------------------------------------

This repository contains two separate scripts. It is recommended to install both for the best experience.
本仓库包含两个独立的脚本。为获得最佳体验，建议将两个脚本全部安装。

***

### 1. Auto Login & Messages Script
### 脚本一：自动登录与消息脚本

**Description:** This is a utility script that automates the login process. On first use, it will securely prompt for your email and password. On subsequent visits, it will automatically fill in the login form and navigate you to the main messages page, ready for monitoring.
**描述：** 这是一个用于实现自动登录的实用工具脚本。首次运行时，它会安全地提示您输入邮箱和密码。在后续访问中，它会自动填充登录表单，并将您导航至主消息页面，为监控做好准备。

**Features:**
**功能特性：**
* Automatic login to the site.
    自动登录网站。
* One-time prompt for credentials, which are then stored locally.
    一次性提示输入凭据，随后存储于本地。
* Uses Base64 encoding to obfuscate the stored password. **Please note:** This is not strong encryption but prevents the password from being stored in plain text.
    使用Base64编码对存储的密码进行混淆。**请注意：** 这并非强加密，其目的是避免密码以纯文本形式存储。
* Intelligently navigates to the messages page and avoids unnecessary actions if you are already there.
    智能导航至消息页面，并在您已处于目标页面时避免不必要的操作。

***

### 2. Scanner & Notifier Script
### 脚本二：扫描与通知脚本

**Description:** This is the main monitoring script, designed to run on the Cat in a Flat messages page. It actively watches for new job notifications and alerts you through your configured channels.
**描述：** 这是主监控脚本，设计用于在 Cat in a Flat 的消息页面上运行。它会主动监视新的工作通知，并通过您配置的渠道向您发出警报。

**Features:**
**功能特性：**
* Real-time floating monitor panel with countdowns.
    提供一个信息浮窗，实时显示倒计时。
* Multi-channel notifications: Sound, Desktop Pop-up, Email, and Tab Flashing.
    全渠道通知：声音、桌面弹窗、邮件和标签页闪烁。
* Intelligent wake-up detection after computer sleeps.
    电脑休眠唤醒后可进行智能检测。
* Remote offline alerts via email (heartbeat detection) if your computer is off or disconnected.
    当您的电脑关机或断网时，可通过邮件发送远程离线报警（心跳检测）。
* Visual settings panel to configure all options.
    提供可视化设置面板以配置所有选项。
* Persistent logging system for easy troubleshooting.
    提供持久化日志系统以方便排查问题。

-----------------------------------------------------
INSTALLATION & CONFIGURATION GUIDE
安装与配置指南
-----------------------------------------------------

Please follow these four steps precisely to ensure all features function correctly.
请严格按照以下四个步骤进行操作，以确保所有功能都能正常工作。

=== STEP 1: PREREQUISITES ===
=== 第一步：准备工作 ===

1. A modern desktop browser, such as Google Chrome or Mozilla Firefox.
   一个现代的桌面浏览器，例如 Google Chrome 或 Mozilla Firefox。
2. The Tampermonkey browser extension must be installed. Official website: https://www.tampermonkey.net/
   必须安装 Tampermonkey 浏览器扩展。官网：https://www.tampermonkey.net/

=== STEP 2: INSTALL THE USER SCRIPTS ===
=== 第二步：安装油猴脚本 ===

Click the links below for a one-click installation. It is recommended to install both.
点击下方的链接即可一键安装。建议将两个脚本全部安装。

* --> **1. Auto Login Script / 自动登录脚本:**
  https://github.com/LyundipLye/CatinaFlatScanner/raw/main/Catinaflat_Auto_Login_&_Messages.user.js

* --> **2. Scanner & Notifier Script / 扫描与通知脚本:**
  https://github.com/LyundipLye/CatinaFlatScanner/raw/main/Cat_in_a_Flat_UK_Monitor.user.js

=== STEP 3: SET UP THE GOOGLE APPS SCRIPT (GAS) BACK-END ===
=== 第三步：设置Google Apps Script (GAS) 后端 ===

This step is required for the Scanner & Notifier script's email and remote alert features.
“扫描与通知脚本”的邮件和远程报警功能需要此步骤。

1. Create the Script
   创建脚本
   - Go to script.google.com and click on "+ New project".
     前往 script.google.com 并点击“+ 新建项目”。

2. Paste the Code
   粘贴代码
   - Copy all the code from the `Google_Apps_Script_Backend.gs` file.
     将项目中 `Google_Apps_Script_Backend.gs` 文件的所有代码复制进去。
   - --> GET THE GAS BACK-END CODE HERE / 点击此处获取GAS后端代码:
     https://raw.githubusercontent.com/LyundipLye/CatinaFlatScanner/main/Google_Apps_Script_Backend.gs
   - Paste the code into the editor, replacing all original content. Give your project a name.
     将代码完整粘贴到编辑器中，替换掉所有原始内容。给您的项目命名。

3. Save and Deploy
   保存并部署
   - Click the save icon (💾).
     点击软盘图标💾保存项目。
   - Click the blue "Deploy" button and select "New deployment".
     点击右上角的蓝色“部署”按钮，选择“新建部署”。
   - Next to "Select type", click the gear icon (⚙️) and choose "Web app".
     在“选择类型”旁边，点击齿轮⚙️图标，选择“Web应用”。
   - Configure as follows: Execute as "Me", Who has access "Anyone".
     进行如下配置：执行者 "我", 谁拥有访问权限 "任何人"。
   - Click "Deploy", authorise access (clicking through any "unsafe" warnings), and **copy the final Web app URL.**
     点击“部署”，授权访问（包括点击任何“不安全”的警告），然后**复制最终的Web应用URL**。

4. Create the Time-based Trigger (Activate Remote Alerts)
   创建时间触发器 (激活远程报警)
   - In the GAS editor, select the `createHeartbeatTrigger` function from the top menu and click the "Run" button (▶️).
     在GAS编辑器中，从顶部菜单选择 `createHeartbeatTrigger` 函数并点击“运行”(▶️)按钮。

=== STEP 4: CONNECT THE SCANNER SCRIPT TO GAS ===
=== 第四步：关联扫描脚本与GAS ===

1. Open any page on catinaflat.co.uk.
   打开任意一个 catinaflat.co.uk 的页面。
2. Click the "⚙️ Settings" button in the script's floating panel.
   在脚本的浮窗中点击“⚙️ 设置”按钮。
3. Paste the Web app URL you copied in Step 3.3 into the "Google Apps Script URL" field.
   将您在第三步第3点中复制的Web应用URL粘贴到“Google Apps Script URL”输入框中。
4. Click "Save settings".
   点击“保存设置”。

All done! The system is now fully configured and operational.
至此，全部配置完成！

-----------------------------------------------------
FREQUENTLY ASKED QUESTIONS (FAQ)
常见问题
-----------------------------------------------------

1. Q: I didn't receive an offline email alert after disconnecting. Why?
   问：我关闭了网页/断网了，为什么没有立即收到掉线报警邮件？
   A: The system has two timers: the offline threshold (default: 5 mins) and the check interval (default: 1 min). You must be offline for longer than the threshold, and the alert will only be sent after the next scheduled check runs. This can take between 20-30 minutes in total.
   答：系统有两个时间：一个是掉线阈值（默认为5分钟），另一个是检查周期（触发器每1分钟运行一次）。您的脚本必须停止更新超过阈值时间，并且警报只会在下一次检查运行时才发送，所以总共可能需要等待20到30分钟。

2. Q: I closed the webpage, but the logs in my Google Sheet are still updating. Why?
   问：我关闭了网页，为什么日志还在更新？
   A: This means an instance of the user script is still running somewhere else. Please check other browser tabs, other windows, other web browsers on the same computer, or even other devices where you might have installed the script.
   答：这说明脚本的另一个实例仍在别处运行。请检查其他的浏览器标签页、窗口、您电脑上的其他浏览器、或者您安装过此脚本的其他电脑或设备。

-----------------------------------------------------
LICENCE
开源许可证
-----------------------------------------------------

This project is licensed under the MIT Licence.
本项目基于 MIT 许可证开源。
