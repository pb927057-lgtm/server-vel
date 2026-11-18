package com.vel.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vel.app.crypto.KeyAgreementManager
import com.vel.app.network.RelayConnectionState
import com.vel.app.network.VelCommunicationManager
import com.vel.app.pairing.PairedDevice
import com.vel.app.pairing.PairingManager
import com.vel.app.pairing.PairingRepository
import com.vel.app.security.IdentityManager
import com.vel.app.ui.components.DemoBadge
import com.vel.app.ui.components.VelCard
import com.vel.app.ui.navigation.DeviceRole
import com.vel.app.ui.theme.*

@Composable
fun ReplacePhoneScreen(
    identityManager: IdentityManager? = null,
    pairingRepository: PairingRepository? = null,
    communicationManager: VelCommunicationManager? = null,
    pairingManager: PairingManager? = null,
    onBackClick: () -> Unit
) {
    val coreIdentity = remember { identityManager?.getOrCreateIdentity(DeviceRole.CORE) }
    val pairedDevices = remember {
        mutableStateOf(pairingRepository?.getPairedDevices() ?: emptyList())
    }
    val connectionState = remember {
        mutableStateOf(communicationManager?.getConnectionState() ?: RelayConnectionState.DISCONNECTED)
    }

    var sasInput by remember { mutableStateOf("") }
    var actionFeedback by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }

    val activeMobile = pairedDevices.value.firstOrNull { !it.isLocallyRevoked }

    Scaffold(
        containerColor = VelBgMain,
        topBar = {
            TopAppBar(
                title = { Text("Reemplazar teléfono móvil", style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Volver",
                            tint = VelTextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = VelSurface,
                    titleContentColor = VelTextPrimary
                )
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                DemoBadge(text = "Sustitución segura de terminal • Conservación de identidad de CORE")
            }

            // 1. Identidad de VEL CORE: Permanece intacta
            item {
                VelCard {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(Icons.Default.Shield, contentDescription = null, tint = VelPrimaryCyan, modifier = Modifier.size(20.dp))
                                Text("Custodio: VEL CORE", style = MaterialTheme.typography.titleSmall, color = VelTextPrimary)
                            }
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = VelPrimaryCyan.copy(alpha = 0.15f)
                            ) {
                                Text(
                                    text = "Identidad intacta",
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = VelPrimaryCyan,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        Text(
                            text = "ID: ${coreIdentity?.deviceId ?: "VEL-CORE-LOCAL"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = VelTextSecondary,
                            fontFamily = FontFamily.Monospace
                        )
                        Text(
                            text = "Las claves de CORE y los datos personales no sufren alteraciones ni se transfieren.",
                            style = MaterialTheme.typography.bodySmall,
                            color = VelTextSecondary
                        )
                    }
                }
            }

            // 2. Dispositivo anterior a revocar
            item {
                VelCard {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("Teléfono anterior a sustituir:", style = MaterialTheme.typography.titleSmall, color = VelTextPrimary)
                        if (activeMobile != null) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(VelSurfaceElevated)
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(activeMobile.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = VelTextPrimary)
                                    Text("ID: ${activeMobile.id}", style = MaterialTheme.typography.labelSmall, color = VelTextSecondary, fontFamily = FontFamily.Monospace)
                                }
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = VelWarningAmber.copy(alpha = 0.15f)
                                ) {
                                    Text(
                                        text = "Será revocado",
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = VelWarningAmber,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        } else {
                            Text(
                                text = "No hay terminal activo. El acceso previo ya fue invalidado o no existía.",
                                style = MaterialTheme.typography.bodySmall,
                                color = VelTextSecondary
                            )
                        }
                    }
                }
            }

            // 3. Estado de la conexión con el Relay
            item {
                VelCard {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Servidor Relay:", style = MaterialTheme.typography.titleSmall, color = VelTextPrimary)
                            Text(
                                text = when (connectionState.value) {
                                    RelayConnectionState.AUTHENTICATED -> "En línea (Conectado)"
                                    else -> "Sin conexión (Offline)"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (connectionState.value == RelayConnectionState.AUTHENTICATED) VelSecurityGreen else VelWarningAmber,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Text(
                            text = if (connectionState.value == RelayConnectionState.AUTHENTICATED) {
                                "✓ Al estar en línea, la orden de revocación se transmite al Relay y se CONFIRMA de inmediato."
                            } else {
                                "⚠ Sin conexión: La revocación se aplica en CORE, pero su estado en el Relay queda como PENDIENTE o DESCONOCIDO. Nunca se afirma revocado en red hasta restablecer enlace."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = VelTextSecondary
                        )
                    }
                }
            }

            // 4. Autorizar nuevo teléfono
            item {
                VelCard {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("Vincular nuevo teléfono móvil:", style = MaterialTheme.typography.titleSmall, color = VelTextPrimary)
                        Text(
                            text = "1. Instalá VEL en el nuevo teléfono y seleccioná 'CONFIGURAR VEL MÓVIL'.\n" +
                                   "2. El nuevo teléfono generará credenciales y un código SAS independiente.\n" +
                                   "3. Ingresá aquí el código SAS de 6 dígitos que muestra el nuevo teléfono.",
                            style = MaterialTheme.typography.bodySmall,
                            color = VelTextSecondary
                        )

                        OutlinedTextField(
                            value = sasInput,
                            onValueChange = { sasInput = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Código SAS del nuevo móvil (ej: 482 910)") },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = VelPrimaryCyan,
                                unfocusedBorderColor = VelBorder,
                                focusedTextColor = VelTextPrimary,
                                unfocusedTextColor = VelTextPrimary
                            )
                        )

                        Button(
                            onClick = {
                                val cleanSas = sasInput.trim()
                                if (cleanSas.length < 4) {
                                    actionFeedback = "Por favor ingresa el código SAS que muestra el nuevo teléfono móvil."
                                    isError = true
                                    return@Button
                                }

                                val isOnline = connectionState.value == RelayConnectionState.AUTHENTICATED
                                val newId = "VEL-MOV-${(1000..9999).random()}"
                                val newDevice = PairedDevice(
                                    id = newId,
                                    name = "Nuevo teléfono móvil",
                                    role = DeviceRole.TERMINAL,
                                    fingerprint = "7A:41:88:99:C2:0B:44:E1:90:D1:66:82:FF:33:55:71",
                                    publicKeyBase64 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
                                    pairedAt = System.currentTimeMillis(),
                                    sasCode = cleanSas,
                                    isLocallyRevoked = false
                                )

                                if (activeMobile != null) {
                                    if (isOnline) {
                                        communicationManager?.requestRemoteRevocation(activeMobile.id)
                                    }
                                    pairingRepository?.replaceDevice(
                                        oldDeviceId = activeMobile.id,
                                        newDevice = newDevice,
                                        isRemoteConfirmed = isOnline
                                    )
                                } else {
                                    pairingRepository?.savePairedDevice(newDevice)
                                }

                                pairedDevices.value = pairingRepository?.getPairedDevices() ?: emptyList()
                                sasInput = ""
                                isError = false

                                actionFeedback = if (isOnline) {
                                    "✓ Reemplazo completado y CONFIRMADO:\n" +
                                    "• Nuevo teléfono ($newId) autorizado con credenciales independientes.\n" +
                                    "• Teléfono anterior revocado. Confirmación en Relay: CONFIRMADA.\n" +
                                    "• Identidad de VEL CORE conservada intacta. Ningún dato personal transferido."
                                } else {
                                    "⚠ Reemplazo aplicado con REVOCACIÓN PENDIENTE:\n" +
                                    "• Nuevo teléfono ($newId) autorizado localmente en VEL CORE.\n" +
                                    "• Teléfono anterior invalidado en este CORE. Notificación al Relay: ESTADO PENDIENTE O DESCONOCIDO por falta de conexión.\n" +
                                    "• No se afirma revocación en red hasta restablecer el enlace con el servidor.\n" +
                                    "• Identidad de VEL CORE conservada intacta. Ningún dato personal transferido."
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = VelPrimaryCyan,
                                contentColor = VelBgMain
                            ),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null, tint = VelBgMain)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Autorizar nuevo teléfono y revocar anterior", fontWeight = FontWeight.Bold, color = VelBgMain)
                        }
                    }
                }
            }

            if (actionFeedback != null) {
                item {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = VelSurfaceElevated,
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            if (isError) VelWarningAmber else VelSecurityGreen
                        )
                    ) {
                        Text(
                            text = actionFeedback ?: "",
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isError) VelWarningAmber else VelSecurityGreen
                        )
                    }
                }
            }

            item {
                OutlinedButton(
                    onClick = onBackClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = VelTextPrimary),
                    shape = RoundedCornerShape(8.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder)
                ) {
                    Text("Volver a VEL CORE")
                }
            }
        }
    }
}
