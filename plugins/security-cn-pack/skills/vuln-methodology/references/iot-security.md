# IoT/嵌入式设备安全

## 完整渗透流程

### 1. 侦察
- 识别设备型号、固件版本、暴露服务
- 检查默认凭证（Router Passwords 数据库）
- 搜索已知 CVE

### 2. 固件获取
- 官网下载（最容易）
- UART/JTAG 提取（物理访问）
- 工具：**Binwalk**、**FACT**、**EMBA**、**Firmadyne**

### 3. 静态分析
```bash
binwalk -e firmware.bin          # 提取文件系统
firmwalker firmware/             # 搜索硬编码凭证
# Ghidra/IDA Pro/Radare2 分析二进制
```

### 4. 动态分析
- **Firmadyne/FirmAE** — 仿真固件运行
- **Boofuzz/AFL++** — 模糊测试
- **Saleae** — 逻辑分析仪监控

### 5. 硬件攻击
- **UART**：识别 PCB 焊盘 → 连接 → root shell → 提取固件
  - 工具：Bus Pirate、Shikra、Glasgow、GreatFET
- **JTAG/SWD**：
  - 工具：OpenOCD、JTAGenum、SEGGER J-Link
  - 路径：JTAG → dump 固件 → 离线分析 → 找漏洞

### 6. 无线协议
| 协议 | 工具 |
|------|------|
| BLE | Ubertooth One、Btlejack、Sniffle |
| ZigBee | KillerBee、ApiMote |
| SDR | RTL-SDR、HackRF One、BladeRF |
| RFID/NFC | Proxmark 3 RDV4、ChameleonUltra |
| WiFi | bettercap |

### 7. 故障注入（高级）
- **电压毛刺**：ChipWhisperer、Pico Glitcher
- **电磁故障注入**：ChipSHOUTER
- 目标：绕过安全启动（STM32/ESP32）

## 真实案例
| 目标 | 漏洞 | 影响 |
|------|------|------|
| D-Link DWR-932B | 多漏洞 | 完全控制 |
| Huawei HG533 | UART 固件逆向 | 凭证提取 |
| Philips Hue Bridge | root 访问 | 完全控制 |
| SpaceX Starlink | 毛刺攻击 | 用户终端沦陷 |
| ESP32-C3/C6 | 故障注入 | 闪存加密绕过 |

## SRC 实战要点
- **默认凭证仍是 IoT 第一攻击向量**（Mirai 僵尸网络证明）
- **UART 调试端口**经常无保护 = 物理访问 = root shell
- **Binwalk 固件提取**是找硬编码密钥的第一步
- 工控/车联网是蓝海，赏金高竞争少
