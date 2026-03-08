const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { db } = require('./database/db');
const { exportSalesReportToExcel } = require('./main/reports');

let mainWindow;

function createWindow() {

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');

}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});



/* =====================================================
   DATABASE IPC HANDLER
===================================================== */

ipcMain.handle('db-query', async (event, sql, params = [], type = "all") => {

    return new Promise((resolve, reject) => {

        if (type === "run") {

            db.run(sql, params, function (err) {

                if (err) reject(err);
                else resolve({
                    id: this.lastID,
                    changes: this.changes
                });

            });

        }

        else if (type === "get") {

            db.get(sql, params, (err, row) => {

                if (err) reject(err);
                else resolve(row);

            });

        }

        else {

            db.all(sql, params, (err, rows) => {

                if (err) reject(err);
                else resolve(rows);

            });

        }

    });

});



/* =====================================================
   BILL SAVE IPC
===================================================== */

ipcMain.handle("save-bill", async (event, data) => {

    try {

        const result = await saveBill(data);
        return result;

    } catch (error) {

        console.error("Save Bill Error:", error);
        throw error;

    }

});



/* =====================================================
   PRINT INVOICE
===================================================== */

ipcMain.handle("print-invoice", async (event, html) => {

    let printWindow = new BrowserWindow({
        show: false
    });

    printWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html)
    );

    printWindow.webContents.on("did-finish-load", () => {

        printWindow.webContents.print({
            silent: false,
            printBackground: true
        }, () => {

            printWindow.close();

        });

    });

});



/* =====================================================
   EXCEL EXPORT
===================================================== */

ipcMain.handle("export-sales-excel", async (event, reportData) => {

    try {

        return await exportSalesReportToExcel(reportData);

    } catch (error) {

        console.error("Excel Export Error:", error);
        throw error;

    }

});



/* =====================================================
   HELPER FUNCTIONS
===================================================== */

function runQuery(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.run(sql, params, function (err) {

            if (err) reject(err);
            else resolve({
                id: this.lastID,
                changes: this.changes
            });

        });

    });

}

function getQuery(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.get(sql, params, (err, row) => {

            if (err) reject(err);
            else resolve(row);

        });

    });

}



/* =====================================================
   GENERATE INVOICE NUMBER
===================================================== */

async function generateInvoiceNumber() {

    let nextNum = 1;

    const lastInvoice = await getQuery(
        "SELECT invoiceNumber FROM bills ORDER BY id DESC LIMIT 1"
    );

    if (lastInvoice && lastInvoice.invoiceNumber) {

        const lastPart = parseInt(
            lastInvoice.invoiceNumber.split("-")[1]
        );

        if (!isNaN(lastPart)) nextNum = lastPart + 1;

    }

    return "INV-" + nextNum.toString().padStart(4, "0");

}



/* =====================================================
   SAVE BILL CORE LOGIC
===================================================== */

async function saveBill(data) {

    return new Promise(async (resolve, reject) => {

        try {

            await runQuery("BEGIN TRANSACTION");

            const invoiceNumber = await generateInvoiceNumber();

            const billRes = await runQuery(

                `INSERT INTO bills
                (invoiceNumber, customerId, totalAmount, discountPercent, discountAmount, netTaxable, gstAmount, exchangeValue, grandTotal, paymentMode)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    invoiceNumber,
                    data.customerId,
                    data.totalAmount,
                    data.discountPercent,
                    data.discountAmount,
                    data.netTaxable,
                    data.gstAmount,
                    data.exchangeValue,
                    data.grandTotal,
                    data.paymentMode
                ]

            );

            const billId = billRes.id;


            for (let item of data.items) {

                await runQuery(

                    `INSERT INTO bill_items
                    (billId, productId, quantity, price, gstAmount, cgstAmount, sgstAmount, totalGstAmount, total)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        billId,
                        item.productId,
                        item.quantity,
                        item.price,
                        item.gst,
                        item.gst / 2,
                        item.gst / 2,
                        item.gst,
                        item.total
                    ]

                );

                await runQuery(

                    "UPDATE products SET stock = stock - ? WHERE id = ?",
                    [item.quantity, item.productId]

                );

            }

            await runQuery("COMMIT");

            resolve({
                success: true,
                billId,
                invoiceNumber
            });

        }

        catch (error) {

            await runQuery("ROLLBACK");
            reject(error);

        }

    });

}