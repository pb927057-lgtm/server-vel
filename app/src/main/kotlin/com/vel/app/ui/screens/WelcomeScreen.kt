package com.vel.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vel.app.ui.components.VelLogo
import com.vel.app.ui.theme.*

@Composable
fun WelcomeScreen(
    onConfigureCoreClick: () -> Unit,
    onConfigureMovilClick: () -> Unit,
    onOpenContractClick: () -> Unit = {},
    onOpenHelpClick: () -> Unit = {}
) {
    var showHelpDialog by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(VelBgMain)
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Cabecera superior con botón de ayuda (ⓘ)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = VelSurfaceElevated,
                    border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder)
                ) {
                    Text(
                        text = "VEL 0.1",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = VelPrimaryCyan,
                        fontWeight = FontWeight.Bold
                    )
                }

                IconButton(
                    onClick = { showHelpDialog = true },
                    modifier = Modifier.size(36.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = VelSurface,
                        border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = "ⓘ",
                                color = VelPrimaryCyan,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                        }
                    }
                }
            }

            // Identidad y Logo
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                VelLogo(size = 76.dp)

                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "Bienvenido a VEL",
                        style = MaterialTheme.typography.headlineMedium,
                        color = VelTextPrimary,
                        letterSpacing = 1.sp,
                        fontWeight = FontWeight.ExtraBold,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = "Protección inteligente de tu información personal.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = VelTextSecondary,
                        textAlign = TextAlign.Center
                    )
                }
            }

            // Explicación de los dos roles y necesidad de dos teléfonos Android
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = VelSurface,
                border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "ARQUITECTURA DE DOS TELÉFONOS ANDROID",
                        style = MaterialTheme.typography.labelSmall,
                        color = VelPrimaryCyan,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp
                    )

                    // Tarjeta VEL CORE
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = VelSurfaceElevated,
                        border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder)
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                text = "VEL CORE (Custodio Exclusivo)",
                                color = Color.White,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "Teléfono principal en lugar seguro. Custodia exclusiva de tus datos personales, notas y claves criptográficas maestras.",
                                color = VelTextSecondary,
                                style = MaterialTheme.typography.bodySmall,
                                fontSize = 11.sp
                            )
                        }
                    }

                    // Tarjeta VEL MÓVIL
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = VelSurfaceElevated,
                        border = androidx.compose.foundation.BorderStroke(1.dp, VelBorder)
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                text = "VEL MÓVIL (Terminal de Operación)",
                                color = Color.White,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "Teléfono de uso diario en la calle. No almacena tus datos sensibles; solo opera como terminal autorizado de consulta.",
                                color = VelTextSecondary,
                                style = MaterialTheme.typography.bodySmall,
                                fontSize = 11.sp
                            )
                        }
                    }

                    Text(
                        text = "Requiere dos teléfonos Android para garantizar soberanía y que una pérdida o robo en la calle nunca exponga tus datos.",
                        color = VelPrimaryCyan.copy(alpha = 0.9f),
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Llamado a la acción: Comenzar la configuración de VEL
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = VelSurface,
                border = androidx.compose.foundation.BorderStroke(1.dp, VelPrimaryCyan.copy(alpha = 0.35f))
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Comenzar la configuración de VEL",
                        style = MaterialTheme.typography.titleSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )

                    Text(
                        text = "Seleccioná el rol para este dispositivo:",
                        style = MaterialTheme.typography.bodySmall,
                        color = VelTextSecondary,
                        fontSize = 12.sp
                    )

                    // Botón 1: CONFIGURAR VEL CORE
                    Button(
                        onClick = onConfigureCoreClick,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = VelPrimaryCyan,
                            contentColor = VelBgMain
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = "CONFIGURAR VEL CORE",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 13.sp,
                            color = VelBgMain
                        )
                    }

                    // Botón 2: CONFIGURAR VEL MÓVIL
                    Button(
                        onClick = onConfigureMovilClick,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = VelSurfaceElevated,
                            contentColor = Color.White
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, VelPrimaryCyan.copy(alpha = 0.6f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = "CONFIGURAR VEL MÓVIL",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 13.sp,
                            color = VelPrimaryCyan
                        )
                    }
                }
            }

            // Enlace al contrato sin mencionar Blogger
            TextButton(
                onClick = onOpenContractClick,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = "Consultar términos y condiciones ↗",
                    color = VelTextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            // Pie de pantalla
            Text(
                text = "Versión 0.1 • Soberanía y protección criptográfica",
                style = MaterialTheme.typography.bodySmall,
                color = VelTextSecondary.copy(alpha = 0.6f),
                fontSize = 10.sp
            )
        }
    }

    // Diálogo de Ayuda e Información (ⓘ)
    if (showHelpDialog) {
        AlertDialog(
            onDismissRequest = { showHelpDialog = false },
            title = {
                Text(
                    text = "Información y Ayuda VEL",
                    color = VelPrimaryCyan,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = "1. Arquitectura de dos teléfonos",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                    Text(
                        text = "VEL separa las funciones: VEL CORE es el custodio exclusivo de tus datos y claves. VEL MÓVIL es el terminal personal de acceso autorizado.",
                        color = VelTextSecondary,
                        fontSize = 11.sp
                    )

                    Text(
                        text = "2. Desinstalación",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                    Text(
                        text = "VEL puede desinstalarse normalmente desde Android manteniendo presionado el ícono y seleccionando 'Desinstalar'.",
                        color = VelTextSecondary,
                        fontSize = 11.sp
                    )

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = VelEmergencyRed.copy(alpha = 0.15f),
                        border = androidx.compose.foundation.BorderStroke(1.dp, VelEmergencyRed.copy(alpha = 0.4f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Text(
                                text = "Libertad de Contratación:",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.sp
                            )
                            Text(
                                text = "No existe permanencia obligatoria. No se cobra por descargar, instalar, reinstalar, configurar, reemplazar o revocar dispositivos. Puedes cancelar tu suscripción libremente desde el sitio web.",
                                color = Color(0xFFFCA5A5),
                                fontSize = 10.sp
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showHelpDialog = false }) {
                    Text("Entendido", color = VelPrimaryCyan, fontWeight = FontWeight.Bold)
                }
            },
            containerColor = VelSurfaceElevated
        )
    }
}
