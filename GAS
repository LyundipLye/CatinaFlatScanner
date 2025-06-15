// == Google Apps Script v3.0 - Heartbeat Monitor Enabled ==
//
// 描述：此脚本作为 Tampermonkey 脚本的后端，用于接收来自 Cat in a Flat 网站的数据，
// 并将状态日志、运行日志、原始请求和错误信息记录到指定的 Google Sheet 中。
//
// 本次更新 (v3.0):
// 1.  正式启用并详细说明【心跳检测】功能，该功能在脚本长时间未更新时通过邮件提醒您。
// 2.  调整了心跳检测的默认阈值为20分钟，以减少误报。
// 3.  提供了如何创建时间触发器来自动运行心跳检测的明确说明。
//
// ==============================================================================
//           **** 重要：如何激活远程离线报警功能 ****
// ==============================================================================
// 1.  在 Apps Script 编辑器中，保存此代码 (按 Ctrl+S 或 Cmd+S)。
// 2.  在上方函数选择菜单中，找到并选择 `createHeartbeatTrigger` 函数。
// 3.  点击“运行”(▶️)按钮。
// 4.  Google 可能会要求您授权脚本权限。请点击“审核权限”，选择您的Google账户，
//     然后点击“高级”，再选择“转至... (不安全)”并授权。这是为了允许脚本代表您
//     发送邮件和创建触发器。
// 5.  运行成功后，您应该会在下方的“执行日志”中看到 "✅ 心跳检测触发器已成功创建！" 的消息。
//     此后，心跳检测将每 10 分钟自动检查一次。如果超过 `HEARTBEAT_THRESHOLD_MINUTES` 
//     分钟没有收到更新，您会收到一封邮件提醒。
//
// 要查看或删除触发器，请点击左侧边栏的“触发器”(⏰)图标。
// ==============================================================================


// --- 配置部分 ---
const SPREADSHEET_ID = "14G8ZU8L6yWmSehpOhMcJo7R7sLNMk63Rx_GxfWMf7Fk"; // <-- 请确认这是你的 Spreadsheet ID
const TARGET_TIMEZONE = "Europe/London";
const MAX_STATUS_LOG_ROWS = 20;
const MAX_RAW_LOGS_ROWS = 20;

// --- 心跳检测配置 ---
// 【修改点】将阈值调整为20分钟，更合理，避免因网络波动等短暂问题导致误报。
const HEARTBEAT_THRESHOLD_MINUTES = 5;
const HEARTBEAT_ALERT_SUBJECT = "【警告】Cat in a Flat 脚本长时间未更新！";
const HEARTBEAT_ALERT_MESSAGE = "您的 Cat in a Flat Tampermonkey 脚本已超过 %MINUTES% 分钟未向 Google Sheet 发送状态更新。\n\n" +
                                "这可能意味着：\n" +
                                "- 您的电脑已关机或休眠。\n" +
                                "- 浏览器已关闭。\n" +
                                "- 监控页面已被关闭或网络中断。\n\n" +
                                "请检查电脑状态、网络连接或网站页面。";
const HEARTBET_LOCK_TIMEOUT_SECONDS = 300;


function doGet(e) {
  const currentTime = Utilities.formatDate(new Date(), TARGET_TIMEZONE, "yyyy/MM/dd HH:mm:ss");
  return ContentService.createTextOutput(`Apps Script Web App is LIVE! Current London Time: ${currentTime}. This endpoint expects POST requests.`).setMimeType(ContentService.MimeType.TEXT);
}


function doPost(e) {
  Logger.log("--- New doPost Execution Started ---");
  const scriptRunTime = new Date();
  let rawDataContents = "请求中无postData";
  let parsedData = {};
  let ss;

  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const rawLogSheet = ss.getSheetByName("原始请求日志 (RAW_LOGS)") || ss.insertSheet("原始请求日志 (RAW_LOGS)");
    if (rawLogSheet.getRange("A1").getValue() === "") {
        rawLogSheet.getRange("A1:C1").setValues([["时间", "原始请求数据", "完整的e对象"]]).setFontWeight("bold");
        rawLogSheet.setColumnWidths(1, 3, [180, 300, 400]);
    }
    while (rawLogSheet.getLastRow() > MAX_RAW_LOGS_ROWS) {
        rawLogSheet.deleteRow(2);
    }
    const nowFormatted = Utilities.formatDate(scriptRunTime, TARGET_TIMEZONE, "yyyy/MM/dd HH:mm:ss");

    if (e && e.postData && e.postData.contents) {
      rawDataContents = e.postData.contents;
      try {
        parsedData = JSON.parse(rawDataContents);
      } catch (jsonError) {
        rawLogSheet.appendRow([nowFormatted, rawDataContents, `JSON 解析失败: ${jsonError.toString()}`]);
        throw new Error("JSON parsing failed: " + jsonError.toString());
      }
    } else {
      rawLogSheet.appendRow([nowFormatted, rawDataContents, JSON.stringify(e)]);
      throw new Error("Received request with no valid postData.");
    }
    rawLogSheet.appendRow([nowFormatted, rawDataContents, JSON.stringify(e)]);

    if (parsedData.type === 'statusUpdate') {
      const statusSheet = ss.getSheetByName("脚本状态") || ss.insertSheet("脚本状态");
      if (statusSheet.getRange("A1").getValue() === "") {
        statusSheet.getRange("A1:C1").setValues([["上次更新时间", "刷新倒计时", "当前消息数"]]).setFontWeight("bold");
        statusSheet.setColumnWidths(1, 3, [180, 120, 120]);
      }
      while (statusSheet.getLastRow() > MAX_STATUS_LOG_ROWS) {
          statusSheet.deleteRow(2);
      }
      statusSheet.appendRow([nowFormatted, parsedData.countdown, parsedData.messageCount]);
      PropertiesService.getScriptProperties().deleteProperty('heartbeatAlertSent');
      return ContentService.createTextOutput("Success: Status updated.").setMimeType(ContentService.MimeType.TEXT);

    } else if (parsedData.subject) {
      const emailTo = Session.getActiveUser().getEmail();
      MailApp.sendEmail(emailTo, parsedData.subject, parsedData.message);
      return ContentService.createTextOutput("Success: Email sent.").setMimeType(ContentService.MimeType.TEXT);

    } else {
      throw new Error("Unknown request type. Data: " + rawDataContents);
    }

  } catch (error) {
    Logger.log("Caught an error in doPost: " + error.toString());
    try {
      const errorSheet = ss.getSheetByName("错误日志") || ss.insertSheet("错误日志");
      if (errorSheet.getRange("A1").getValue() === "") {
          errorSheet.getRange("A1:D1").setValues([["时间", "错误信息", "原始请求", "完整e对象"]]).setFontWeight("bold");
          errorSheet.setColumnWidths(1, 4, [180, 300, 300, 400]);
      }
      errorSheet.appendRow([Utilities.formatDate(new Date(), TARGET_TIMEZONE, "yyyy/MM/dd HH:mm:ss"), error.toString(), rawDataContents, e ? JSON.stringify(e) : "e-object-is-undefined"]);
    } catch (sheetError) {
      Logger.log("CRITICAL: Failed to log error to error sheet: " + sheetError.toString());
    }
    return ContentService.createTextOutput("Error: " + error.toString()).setMimeType(ContentService.MimeType.TEXT);
  } finally {
    Logger.log("--- doPost Execution Finished ---");
  }
}


/**
 * 检查脚本心跳。此函数由时间触发器自动调用。
 */
function checkScriptHeartbeat() {
  const lock = LockService.getScriptLock();
  try {
    if(!lock.tryLock(HEARTBET_LOCK_TIMEOUT_SECONDS * 1000)) {
        Logger.log("checkScriptHeartbeat: Could not obtain lock, another instance is likely running.");
        return;
    }
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const statusSheet = ss.getSheetByName("脚本状态");
    if (!statusSheet || statusSheet.getLastRow() < 2) { return; } // No data to check

    const lastUpdateValue = statusSheet.getRange("A" + statusSheet.getLastRow()).getValue();
    if (!lastUpdateValue || !(lastUpdateValue instanceof Date)) { return; }

    const timeSinceLastUpdateMinutes = (Date.now() - lastUpdateValue.getTime()) / (1000 * 60);
    const scriptProperties = PropertiesService.getScriptProperties();
    const alertSentFlag = scriptProperties.getProperty('heartbeatAlertSent');

    Logger.log(`Heartbeat Check: Last update was ${timeSinceLastUpdateMinutes.toFixed(2)} minutes ago.`);

    if (timeSinceLastUpdateMinutes > HEARTBEAT_THRESHOLD_MINUTES) {
      if (alertSentFlag !== 'true') {
        const emailTo = Session.getActiveUser().getEmail();
        const alertMessage = HEARTBEAT_ALERT_MESSAGE.replace('%MINUTES%', HEARTBEAT_THRESHOLD_MINUTES.toString());
        MailApp.sendEmail(emailTo, HEARTBEAT_ALERT_SUBJECT, alertMessage);
        scriptProperties.setProperty('heartbeatAlertSent', 'true');
        Logger.log(`Heartbeat alert SENT for being offline ${timeSinceLastUpdateMinutes.toFixed(2)} minutes.`);
      } else {
        Logger.log("Heartbeat alert condition met, but an alert has already been sent.");
      }
    } else {
      if (alertSentFlag === 'true') {
        scriptProperties.deleteProperty('heartbeatAlertSent');
        Logger.log("Heartbeat condition is now OK. Resetting alert flag.");
      }
    }
  } catch (error) {
    Logger.log("Error in checkScriptHeartbeat: " + error.toString());
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * 创建或重置心跳检测的时间触发器。
 * 运行此函数将删除所有旧的 checkScriptHeartbeat 触发器，并创建一个新的。
 */
function createHeartbeatTrigger() {
  deleteAllTriggers(); // 先删除旧的，防止重复
  
  // ================= 【修改点】 =================
  const triggerIntervalMinutes = 5; // 在这里设置您希望的检查周期（分钟）

  // 使用上面的变量来创建触发器
  ScriptApp.newTrigger('checkScriptHeartbeat')
      .timeBased()
      .everyMinutes(triggerIntervalMinutes)
      .create();
      
  // 使用模板字符串让提示消息动态化
  const message = `✅ 心跳检测触发器已成功创建！脚本将每 ${triggerIntervalMinutes} 分钟检查一次状态。`;
  // ===============================================
  
  Logger.log(message);
  // 如果在电子表格环境中运行，则显示弹窗
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // 在独立脚本编辑器中运行时会报错，忽略即可
  }
}

/**
 * 删除所有与此项目关联的 checkScriptHeartbeat 触发器。
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'checkScriptHeartbeat') {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  if (count > 0) {
    Logger.log(`已删除 ${count} 个旧的 'checkScriptHeartbeat' 触发器。`);
  }
}
