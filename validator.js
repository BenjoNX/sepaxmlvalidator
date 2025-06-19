document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('sepaForm');
    const xmlFileInput = document.getElementById('xmlFile');
    const xmlContent = document.getElementById('xmlContent');
    const validationResults = document.getElementById('validationResults');

    // URLs des schémas XSD SEPA
    const SCHEMA_URLS = {
        credit: 'https://raw.githubusercontent.com/ISO20022/ISO20022/master/Repository/Pain/pain.001.001.03.xsd',
        debit:  'https://raw.githubusercontent.com/ISO20022/ISO20022/master/Repository/Pain/pain.008.001.02.xsd'
    };

    // Cache pour éviter de télécharger plusieurs fois le même XSD
    const schemaCache = {};
    async function loadSchema(url) {
        if (schemaCache[url]) return schemaCache[url];
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Impossible de charger le schéma XSD');
        const text = await resp.text();
        schemaCache[url] = text;
        return text;
    }

    // Gestionnaire pour le chargement de fichier
    xmlFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                xmlContent.value = e.target.result;
            };
            reader.readAsText(file);
        }
    });

    // Fonction de validation XML
    function validateXML(xmlString) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, "text/xml");
            
            const parserError = xmlDoc.getElementsByTagName("parsererror");
            if (parserError.length > 0) {
                return {
                    valid: false,
                    message: "Erreur de format XML: " + parserError[0].textContent
                };
            }

            const rootElement = xmlDoc.documentElement;
            const namespace = rootElement.namespaceURI;
            if (!namespace || !namespace.includes("urn:iso:std:iso:20022")) {
                return {
                    valid: false,
                    message: "Le fichier ne semble pas être un fichier SEPA valide"
                };
            }

            const isCreditTransfer = xmlDoc.getElementsByTagName("CstmrCdtTrfInitn").length > 0;
            const isDirectDebit = xmlDoc.getElementsByTagName("CstmrDrctDbtInitn").length > 0;

            if (!isCreditTransfer && !isDirectDebit) {
                return {
                    valid: false,
                    message: "Le fichier ne semble pas être un fichier SEPA valide (pas de CstmrCdtTrfInitn ou CstmrDrctDbtInitn trouvé)"
                };
            }

            const requiredElements = [
                { name: "Document", type: "element" },
                { name: "GrpHdr", type: "element" },
                { name: "NbOfTxs", type: "element" },
                { name: "CtrlSum", type: "element" }
            ];

            if (isCreditTransfer) {
                requiredElements.push({ name: "CstmrCdtTrfInitn", type: "element" });
            } else {
                requiredElements.push({ name: "CstmrDrctDbtInitn", type: "element" });
            }

            let validationErrors = [];
            requiredElements.forEach(element => {
                const found = xmlDoc.getElementsByTagName(element.name).length > 0;
                if (!found) {
                    validationErrors.push(`Élément requis manquant: ${element.name}`);
                }
            });

            if (isCreditTransfer) {
                const paymentInfos = xmlDoc.getElementsByTagName("PmtInf");
                if (paymentInfos.length === 0) {
                    validationErrors.push("Au moins un élément PmtInf est requis pour les virements");
                }
            } else {
                const paymentInfos = xmlDoc.getElementsByTagName("PmtInf");
                if (paymentInfos.length === 0) {
                    validationErrors.push("Au moins un élément PmtInf est requis pour les prélèvements");
                }
                
                const mandateRelatedInfos = xmlDoc.getElementsByTagName("MndtRltdInf");
                if (mandateRelatedInfos.length === 0) {
                    validationErrors.push("Au moins un élément MndtRltdInf (informations sur le mandat) est requis pour les prélèvements");
                }
            }

            if (validationErrors.length > 0) {
                return {
                    valid: false,
                    message: validationErrors.join("\n")
                };
            }

            const details = {
                header: {},
                payments: [],
                mandates: [],
                transactions: []
            };

            const groupHeader = xmlDoc.getElementsByTagName("GrpHdr")[0];
            if (groupHeader) {
                details.header = {
                    msgId: groupHeader.getElementsByTagName("MsgId")[0]?.textContent,
                    creationDate: groupHeader.getElementsByTagName("CreDtTm")[0]?.textContent,
                    nbOfTxs: groupHeader.getElementsByTagName("NbOfTxs")[0]?.textContent,
                    ctrlSum: groupHeader.getElementsByTagName("CtrlSum")[0]?.textContent
                };
            }

            const paymentInfos = xmlDoc.getElementsByTagName("PmtInf");
            for (const payment of paymentInfos) {
                const paymentDetails = {
                    id: payment.getElementsByTagName("PmtInfId")[0]?.textContent,
                    method: payment.getElementsByTagName("PmtMtd")[0]?.textContent,
                    batch: payment.getElementsByTagName("BtchBookg")[0]?.textContent,
                    serviceLevel: payment.getElementsByTagName("SvcLvl")[0]?.getElementsByTagName("Cd")[0]?.textContent,
                    localInstrument: payment.getElementsByTagName("LclInstrm")[0]?.getElementsByTagName("Cd")[0]?.textContent,
                    sequenceType: payment.getElementsByTagName("SeqTp")[0]?.textContent,
                    collectionDate: payment.getElementsByTagName("ReqdColltnDt")[0]?.textContent
                };
                details.payments.push(paymentDetails);
            }

            // Transactions
            if (isCreditTransfer) {
                const txInfos = xmlDoc.getElementsByTagName("CdtTrfTxInf");
                for (const tx of txInfos) {
                    const creditor = tx.getElementsByTagName("Cdtr")[0];
                    const creditorName = creditor?.getElementsByTagName("Nm")[0]?.textContent || "";
                    const creditorAcct = tx.getElementsByTagName("CdtrAcct")[0];
                    const creditorIban = creditorAcct?.getElementsByTagName("IBAN")[0]?.textContent || "";
                    const remittance = tx.getElementsByTagName("RmtInf")[0];
                    const reference = remittance?.getElementsByTagName("Ustrd")[0]?.textContent || "";
                    const amount = tx.getElementsByTagName("InstdAmt")[0]?.textContent || "";
                    details.transactions.push({ name: creditorName, iban: creditorIban, reference, amount });
                }
            } else {
                const txInfos = xmlDoc.getElementsByTagName("DrctDbtTxInf");
                for (const tx of txInfos) {
                    const debtor = tx.getElementsByTagName("Dbtr")[0];
                    const debtorName = debtor?.getElementsByTagName("Nm")[0]?.textContent || "";
                    const debtorAcct = tx.getElementsByTagName("DbtrAcct")[0];
                    const debtorIban = debtorAcct?.getElementsByTagName("IBAN")[0]?.textContent || "";
                    const remittance = tx.getElementsByTagName("RmtInf")[0];
                    const reference = remittance?.getElementsByTagName("Ustrd")[0]?.textContent || "";
                    const amount = tx.getElementsByTagName("InstdAmt")[0]?.textContent || "";
                    details.transactions.push({ name: debtorName, iban: debtorIban, reference, amount });
                }
            }

            if (isDirectDebit) {
                const mandateInfos = xmlDoc.getElementsByTagName("MndtRltdInf");
                for (const mandate of mandateInfos) {
                    const mandateDetails = {
                        mandateId: mandate.getElementsByTagName("MndtId")[0]?.textContent,
                        signatureDate: mandate.getElementsByTagName("DtOfSgntr")[0]?.textContent,
                        sequenceType: mandate.getElementsByTagName("AmdmntInd")[0]?.textContent
                    };
                    details.mandates.push(mandateDetails);
                }
            }

            return {
                valid: true,
                message: `Le fichier XML SEPA ${isCreditTransfer ? "de virement" : "de prélèvement"} semble valide`,
                details: details
            };
        } catch (error) {
            return {
                valid: false,
                message: "Erreur lors de la validation: " + error.message
            };
        }
    }

    // Gestionnaire de soumission du formulaire
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const xmlString = xmlContent.value;
        if (!xmlString.trim()) {
            validationResults.innerHTML = '<div class="validation-error">Veuillez fournir un contenu XML à valider</div>';
            return;
        }

        // Validation structure de base
        const structuralResult = validateXML(xmlString);
        let result = structuralResult;

        // Validation XSD complémentaire si structure OK et xmllint chargé
        if (structuralResult.valid && typeof xmllint !== 'undefined') {
            try {
                const schemaUrl = xmlString.includes('CstmrCdtTrfInitn') ? SCHEMA_URLS.credit : (xmlString.includes('CstmrDrctDbtInitn') ? SCHEMA_URLS.debit : null);
                if (schemaUrl) {
                    const xsdText = await loadSchema(schemaUrl);
                    const xsdRes = xmllint.validateXML({ xml: xmlString, schema: xsdText });
                    if (xsdRes.errors && xsdRes.errors.length) {
                        result = { valid: false, message: 'Erreurs de validation XSD :\n' + xsdRes.errors.join('\n') };
                    }
                }
            } catch(err) {
                result = { valid:false, message:'Erreur de validation XSD : ' + err.message };
            }
        }
        
        if (result.valid) {
            validationResults.innerHTML = `
                <div class="validation-success">
                    <i class="bi bi-check-circle-fill valid"></i>
                    ${result.message}
                </div>
            `;

            // Affichage des détails
            const headerDetails = document.getElementById('headerDetails').querySelector('.details-section');
            const paymentDetails = document.getElementById('paymentDetails').querySelector('.details-section');
            const mandateDetails = document.getElementById('mandateDetails').querySelector('.details-section');

            // En-tête
            headerDetails.innerHTML = `
                <div class="table-responsive">
                    <table class="table">
                        <tbody>
                            ${Object.entries(result.details.header).map(([key, value]) => {
                                const labelMap = { nbOfTxs: 'Nombre de transactions', ctrlSum: 'Montant total', msgId: 'Référence remise', creationDate: 'Date de création' };
                                const label = labelMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                                return `
                                <tr>
                                    <th scope="row">${label}</th>
                                    <td>${value}</td>
                                </tr>`;
                            }).join('') }
                        </tbody>
                    </table>
                </div>
            `;

            // Paiements
            paymentDetails.innerHTML = `
                <div class="table-responsive">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Méthode</th>
                                <th>Service Level</th>
                                <th>Instrument Local</th>
                                <th>Type de Séquence</th>
                                <th>Date de Collecte</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.details.payments.map(payment => `
                                <tr>
                                    <td>${payment.id}</td>
                                    <td>${payment.method}</td>
                                    <td>${payment.serviceLevel}</td>
                                    <td>${payment.localInstrument}</td>
                                    <td>${payment.sequenceType}</td>
                                    <td>${payment.collectionDate}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Transactions table
            const transactionDetails = document.getElementById('transactionDetails').querySelector('.details-section');
            transactionDetails.innerHTML = `
                <div class="table-responsive">
                    <table class="table table-payments">
                        <thead>
                            <tr>
                                <th>Nom</th>
                                <th>IBAN</th>
                                <th>Référence</th>
                                <th>Montant</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.details.transactions.map(tx => `
                                <tr>
                                    <td>${tx.name}</td>
                                    <td>${tx.iban}</td>
                                    <td>${tx.reference}</td>
                                    <td class="text-end">${tx.amount}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Mandats
            if (result.details.mandates.length > 0) {
                mandateDetails.innerHTML = `
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>ID Mandat</th>
                                    <th>Date de Signature</th>
                                    <th>Type de Séquence</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${result.details.mandates.map(mandate => `
                                    <tr>
                                        <td>${mandate.mandateId}</td>
                                        <td>${mandate.signatureDate}</td>
                                        <td>${mandate.sequenceType}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            } else {
                mandateDetails.innerHTML = '<p>Aucun mandat trouvé dans ce fichier.</p>';
            }

        } else {
            validationResults.innerHTML = `
                <div class="validation-error">
                    <i class="bi bi-exclamation-circle-fill invalid"></i>
                    ${result.message}
                </div>
            `;
        }
    });
});
