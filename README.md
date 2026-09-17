# 🚀 iPerf3 Hub & Network Management Toolkit

[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](server/)
[![React](https://img.shields.io/badge/Frontend-React_18_%2B_Vite-61DAFB?logo=react&logoColor=black)](client/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**iPerf3 Hub** คือเครื่องมือบริหารจัดการและทดสอบเครือข่ายแบบครบวงจร (All-in-One Network Testing & Management Suite) พัฒนาบนเว็บอินเทอร์เฟซที่ทันสมัย (Modern Dark UI) พร้อมระบบวิเคราะห์ความเร็วเครือข่าย, สแกนพอร์ต, ตรวจสอบสถานะ IP/Subnet, จัดการ VLAN, คำนวณ Subnet/VLSM, ตรวจสอบ DNS/WHOIS และรีโมตเดสก์ท็อปผ่านเว็บเบราว์เซอร์

---

## 📋 สารบัญ (Table of Contents)
- [✨ จุดเด่นและฟีเจอร์หลัก (Key Features)](#-จุดเด่นและฟีเจอร์หลัก-key-features)
  - [1. ⚡ Client Mode (iPerf3 Bandwidth Tester)](#1--client-mode-iperf3-bandwidth-tester)
  - [2. 📍 Route Trace & Loop Monitoring](#2--route-trace--loop-monitoring)
  - [3. 🔍 Nmap Network Scanner (Zenmap-style GUI)](#3--nmap-network-scanner-zenmap-style-gui)
  - [4. 🌐 IP Address Management (IPAM) & VLAN Pool](#4--ip-address-management-ipam--vlan-pool)
  - [5. 🧮 IP & VLSM Calculator](#5--ip--vlsm-calculator)
  - [6. 🔎 DNS & WHOIS Intelligence Suite](#6--dns--whois-intelligence-suite)
  - [7. 🖥️ Server Mode (iPerf3 Server Daemon)](#7-️-server-mode-iperf3-server-daemon)
  - [8. 📊 Test History & Data Export](#8--test-history--data-export)
  - [9. 🛡️ Remote Access Portal (Web Guacamole)](#9-️-remote-access-portal-web-guacamole)
- [🏗️ สถาปัตยกรรมระบบ (Architecture)](#️-สถาปัตยกรรมระบบ-architecture)
- [🚀 วิธีการติดตั้งและเริ่มใช้งาน (Quick Start)](#-วิธีการติดตั้งและเริ่มใช้งาน-quick-start)
  - [ข้อกำหนดเบื้องต้น (Prerequisites)](#ข้อกำหนดเบื้องต้น-prerequisites)
  - [ขั้นตอนการรันด้วย Docker Compose](#ขั้นตอนการรันด้วย-docker-compose)
  - [การเข้าใช้งาน Web UI](#การเข้าใช้งาน-web-ui)
- [📖 คู่มือการใช้งานแต่ละฟีเจอร์ (How to Use)](#-คู่มือการใช้งานแต่ละฟีเจอร์-how-to-use)
- [⚙️ การตั้งค่า Environment Variables](#️-การตั้งค่า-environment-variables)
- [📦 Portable Mode (สำหรับ Windows Client)](#-portable-mode-สำหรับ-windows-client)

---

## ✨ จุดเด่นและฟีเจอร์หลัก (Key Features)

### 1. ⚡ Client Mode (iPerf3 Bandwidth Tester)
- **การทดสอบแบนด์วิดท์ความเร็วสูง**: รองรับโหมด TCP, UDP, Reverse (ดาวน์โหลด), และ Bidirectional (รับ-ส่งพร้อมกัน)
- **กราฟแสดงผล Real-time**: กราฟแสดง Throughput (Mbps/Gbps), Retransmits, และ Jitter/Loss แบบสดๆ ผ่าน WebSocket
- **Loop Test Mode**: สั่งทดสอบวนซ้ำต่อเนื่องอัตโนมัติจนกว่าจะกดหยุดเอง พร้อมแสดงสถิติแบบย่อแถวเดียว (Loop Status, Total Hops, Min Latency, Target Latency)
- **การตั้งค่าระดับสูง**: ปรับจำนวน Parallel Streams, Duration, Interval, MSS (MTU), Window Size, TOS/DSCP ได้อย่างยืดหยุ่น

### 2. 📍 Route Trace & Loop Monitoring
- **Traceroute แบบกราฟิก**: สแกนเส้นทางเครือข่ายเพื่อตรวจสอบ Hop, IP Router, Round-trip Time (RTT), และ Loss
- **Continuous Loop Trace**: ตรวจสอบ Latency และความเสถียรของเส้นทางปลายทางแบบต่อเนื่อง โดยบันทึกประวัติการทดสอบเป็น Task เดียว ไม่ทำให้ Log แตกย่อย

### 3. 🔍 Nmap Network Scanner (Zenmap-style GUI)
- **11 Scan Profiles สำเร็จรูป**: เช่น Quick scan, Quick scan plus, Intense scan, All TCP ports (1-65535), Ping scan, Vulnerability scan ฯลฯ
- **Command Bar แบบ Zenmap**: สามารถพิมพ์แก้ไข Flag คำสั่ง Nmap เพิ่มเติมได้ตามต้องการ
- **Live Terminal Stream**: หน้าต่าง Terminal แสดงผลการรันคำสั่งแบบ Real-time พร้อมปุ่มคัดลอก (Copy Output)
- **สรุปผลลัพธ์อัตโนมัติ**:
  - **Host Details**: แสดงสถานะ Up/Down, Latency, MAC Address, Hardware Vendor, และ OS Detection
  - **Discovered Ports Table**: ตารางระบุ Port, Protocol, State (Open, Filtered, Closed), Service, และ Software Version

### 4. 🌐 IP Address Management (IPAM) & VLAN Pool
- **จัดการ Subnets (CIDR)**: เพิ่มและติดตาม Subnet เช่น `192.168.1.0/24`, `10.1.1.0/24` ได้อย่างอิสระ
- **High-Accuracy Pure ICMP Echo Scan (`fping`)**: ป้องกันปัญหา Firewall / Proxy หลอกสถานะพอร์ต 80/443 ตรวจจับเครื่องที่มีอยู่จริงในระบบได้อย่างแม่นยำ
- **ตารางแสดงสถานะ IP รายเครื่อง**:
  - สีสถานะชัดเจน (🟢 Used / Online, ⚪ Available / Offline)
  - แสดง DNS PTR Hostname, Response Latency, MAC Vendor
  - **Inline System Name Editing**: กดปุ่มดินสอ (✏️) เพื่อแก้ไขชื่อระบบหรือ Alias ประจำ IP นั้นๆ ได้ทันที และข้อมูลจะถูกบันทึกถาวร
  - ฟิลเตอร์ค้นหา: กรองเฉพาะ Used, Available, หรือพิมพ์ค้นหา IP/ชื่อเครื่อง
- **802.1Q VLAN Management Pool**:
  - สร้างและจัดการ VLAN ID (1–4094), ตั้งชื่อ VLAN, กำหนดแถบสี (Color Tags), และใส่คำอธิบาย
  - เชื่อมโยง (Assign) VLAN เข้ากับ Subnet แต่ละวง พร้อม Badge แสดงชื่อ VLAN สวยงาม
  - ฟิลเตอร์คัดกรอง Subnet ตาม VLAN ได้ในคลิกเดียว

### 5. 🧮 IP & VLSM Calculator
- **Subnet Calculator แบบ Modern UI**:
  - ป้อน IP และเลือก Netmask (/1 ถึง /32)
  - คำนวณ Network Address, Broadcast, Usable Host Range, Subnet Mask, Wildcard Mask, Total & Usable Hosts
  - แสดง IP Class (A, B, C, D, E) และประเภท IP (RFC 1918 Private, Public, Loopback)
  - **32-Bit Binary Bit Map Visualization**: แผนภาพบิต 4 อ็อกเท็ต แยกสีชัดเจนระหว่าง Network Bits (สีฟ้า) กับ Host Bits (สีเขียว)
- **VLSM (Variable Length Subnet Masking) Generator**:
  - กำหนดขนาด Host ที่ต้องการในแต่ละแผนก ระบบจะจัดสรร Subnet ขนาดเหมาะสมที่สุดให้อัตโนมัติโดยไม่เสีย IP โดยเปล่าประโยชน์
- **IPv6 Subnet Calculator**:
  - รองรับ IPv6 Prefix (/1 ถึง /128), ขยายรูปเต็ม (Expanded), ย่อรูป (Compressed), ตรวจสอบ Scope (Global Unicast, Link-Local, ULA)

### 6. 🔎 DNS & WHOIS Intelligence Suite
- **DNS Analyzer**:
  - รองรับ Record Types: `ALL`, `A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `SOA`
  - สลับ DNS Resolver ได้ตามต้องการ (System Default, Cloudflare `1.1.1.1`, Google `8.8.8.8`, Quad9 `9.9.9.9`, OpenDNS)
  - ตารางผลลัพธ์แยก Type, Target, TTL, Priority พร้อม Query Latency
- **Reverse DNS (PTR)**: ป้อน IP เพื่อค้นหาชื่อ Hostname ย้อนกลับ
- **WHOIS Domain & IP Lookup**: ตรวจสอบข้อมูลเจ้าของโดเมน, Registrar, Creation/Expiry Date, Name Servers พร้อม Raw Text

### 7. 🖥️ Server Mode (iPerf3 Server Daemon)
- เปิด/ปิด iPerf3 Server ภายในเครื่องได้โดยตรงผ่านหน้าเว็บ
- กำหนด Port (ค่าเริ่มต้น 5201)
- มีจุดสถานะไฟเขียว/แดง (Live Server Status Dot) แจ้งเตือนสถานะการทำงานแบบ Real-time

### 8. 📊 Test History & Data Export
- บันทึกประวัติการทดสอบทุกประเภท (iPerf3, Traceroute, Nmap)
- เปิดดูย้อนหลังได้ครบถ้วน: กราฟ Throughput, ตาราง Hop Latency, ตาราง Port Nmap และ Console Log
- ปุ่ม **Export to CSV** และ **Export to JSON** สำหรับนำข้อมูลไปทำรายงาน
- ค้นหาและกรองประวัติการทดสอบตามประเภทและชื่อเป้าหมาย

### 9. 🛡️ Remote Access Portal (Web Guacamole)
- เชื่อมต่อ Remote Desktop (RDP), VNC, หรือ SSH ไปยังเครื่องปลายทางผ่านเบราว์เซอร์โดยตรง ไม่ต้องลงโปรแกรม Client เพิ่มเติม

---

## 🏗️ สถาปัตยกรรมระบบ (Architecture)

```
                       [ Web Browser ]
                              │
                    Port 3001 │ HTTP
                              ▼
               ┌───────────────────────────────┐
               │    Frontend (Nginx + React)   │
               │   Modern Dark Dashboard UI    │
               └──────────────┬────────────────┘
                              │
                    Proxy API │ & WebSocket
                              ▼
               ┌───────────────────────────────┐
               │     Backend (FastAPI / Py)    │
               │  - iPerf3 Engine (Client/Srv) │
               │  - Nmap Scanner & Parser      │
               │  - IPAM Scanner (Fping+ICMP)  │
               │  - VLAN & Subnet Storage      │
               │  - DNS/WHOIS (dig, whois)     │
               └──────────────┬────────────────┘
                              │
                   Volume     │ /app/data
                              ▼
               ┌───────────────────────────────┐
               │     Data Persistence (JSON)   │
               │  history.json / subnets.json  │
               │  vlans.json                   │
               └───────────────────────────────┘
```

---

## 🚀 วิธีการติดตั้งและเริ่มใช้งาน (Quick Start)

### ข้อกำหนดเบื้องต้น (Prerequisites)
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) (สำหรับ Linux, Windows WSL2, หรือ macOS)
- Git

### ขั้นตอนการรันด้วย Docker Compose

1. **Clone Repository**:
   ```bash
   git clone https://github.com/pirateszero92/iperf3-app.git
   cd iperf3-app
   ```

2. **สั่งรันคอนเทนเนอร์ (Build & Start)**:
   ```bash
   docker compose up -d --build
   ```

3. **ตรวจสอบสถานะคอนเทนเนอร์**:
   ```bash
   docker compose ps
   ```

### การเข้าใช้งาน Web UI

| บริการ (Service) | พอร์ต (Port) | URL สำหรับเปิดใช้งาน | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| **iPerf3 Hub Web GUI** | `3001` | [http://localhost:3001](http://localhost:3001) | หน้า Dashboard หลักของระบบ |
| **Backend API (Swagger Docs)** | `8001` | [http://localhost:8001/docs](http://localhost:8001/docs) | เอกสาร API และทดสอบ Endpoint |
| **Remote Access Portal** | `8088` | [http://localhost:8088](http://localhost:8088) | เกตเวย์ Remote Desktop / SSH |

---

## 📖 คู่มือการใช้งานแต่ละฟีเจอร์ (How to Use)

### 1. วิธีทดสอบความเร็ว Bandwidth (Client Mode)
1. ไปที่เมนู **Client Mode** ⚡
2. ระบุ **Server IP / Hostname** ของเครื่องปลายทางที่เปิด iPerf3 Server อยู่
3. กำหนด **Port** (ค่าเริ่มต้น `5201`), **Protocol** (TCP / UDP) และ **Duration**
4. หากต้องการทดสอบต่อเนื่อง ให้เปิดสวิตช์ **Loop Mode** (ระบบจะรันต่อเนื่องจนกว่าจะกดปุ่ม Stop)
5. กดปุ่ม **Start Test** เพื่อเริ่มการทดสอบและดูกราฟความเร็วแบบ Real-time

### 2. วิธีใช้งาน Nmap Network Scanner
1. ไปที่เมนู **Nmap Scanner** 🔍
2. ระบุ **Target IP, Subnet หรือ Hostname** ในช่อง Target (เช่น `192.168.1.1` หรือ `10.1.1.0/24`)
3. เลือก **Profile** การสแกนจากเมนู Dropdown (เช่น *Quick scan*, *Intense scan*)
4. หากต้องการปรับแต่งคำสั่งเพิ่มเติม สามารถพิมพ์แก้ไขในแถบ **Command Line** ด้านล่างได้ทันที
5. กดปุ่ม **Scan** เพื่อเริ่มสแกน:
   - ดูผลลัพธ์ดิบได้ที่หน้าต่าง **Terminal Output**
   - ดูพอร์ตที่เปิดพร้อมชื่อบริการและเวอร์ชันได้ในตาราง **Discovered Ports**
   - ดูสถานะเครื่อง, MAC, และ OS ได้ที่การ์ด **Host Details**
6. ผลลัพธ์ทั้งหมดจะถูกบันทึกลงใน **Test History** อัตโนมัติ

### 3. วิธีจัดการ IP Address (IPAM) และ VLAN
1. ไปที่เมนู **IP Management** 🌐
2. **การเพิ่ม Subnet**:
   - กดปุ่ม **+ Add Subnet** ทางแถบด้านซ้าย
   - ระบุ Subnet CIDR (เช่น `10.1.1.0/24`) และตั้งชื่อระบุสาขา/การใช้งาน
   - สามารถเลือกผูกกับ VLAN ที่สร้างไว้ได้ทันที แล้วกดบันทึก
3. **การสแกนตรวจสอบสถานะ IP**:
   - เลือก Subnet ที่ต้องการ จากนั้นกดปุ่ม **⚡ Scan Subnet** ด้านขวาบน
   - ระบบจะสแกนด้วย ICMP Echo อย่างรวดเร็วและแม่นยำ พร้อมอัปเดตสถานะ Online/Offline
4. **การแก้ไขชื่อเครื่อง (System Name)**:
   - ในตาราง IP คลิกที่ไอคอนดินสอ **✏️** ในคอลัมน์ System Name
   - พิมพ์ชื่อเครื่องหรือ Alias ที่ต้องการ แล้วกด Enter หรือคลิกเครื่องหมายถูก **✓** เพื่อบันทึก
5. **การจัดการ VLAN**:
   - คลิกปุ่ม **🏷️ Manage VLANs** เพื่อเปิดหน้าต่างกำหนด VLAN ID, ชื่อ, สี และคำอธิบาย

### 4. วิธีคำนวณ Subnet (IP Calculator)
1. ไปที่เมนู **IP Calculator** 🧮
2. เลือกระหว่าง **IPv4 Subnet**, **VLSM Planner**, หรือ **IPv6 Calculator**
3. ป้อน IP Address และเลือกขนาด Prefix/Netmask
4. ดูผลลัพธ์ Network ID, Usable Range, Broadcast และแผนภาพบิต 32-bit Binary ได้ทันที

### 5. วิธีตรวจสอบ DNS & WHOIS
1. ไปที่เมนู **DNS & WHOIS** 🔎
2. **DNS Lookup**: ป้อนชื่อโดเมน เลือกประเภท Record (เช่น A, MX, TXT) และเลือก Nameserver ที่ต้องการสอบถาม จากนั้นกด **Lookup**
3. **WHOIS Query**: ป้อนโดเมนหรือ IP เพื่อดูรายละเอียดข้อมูลการจดทะเบียนผู้ถือครอง

---

## ⚙️ การตั้งค่า Environment Variables

สามารถกำหนดตัวแปรเพิ่มเติมได้ในไฟล์ `.env` หรือใน `docker-compose.yml`:

| ตัวแปร (Variable) | ค่าเริ่มต้น (Default) | คำอธิบาย |
| :--- | :--- | :--- |
| `REMOTE_PORT` | `8088` | พอร์ตภายนอกสำหรับบริการ Remote Access Gateway |
| `APP_USER` | `admin` | ชื่อผู้ใช้งานสำหรับเข้าระบบ Remote Access |
| `APP_PASS` | `password` | รหัสผ่านสำหรับเข้าระบบ Remote Access |
| `APP_SECRET` | `change-this-...` | Secret Key สำหรับการเข้ารหัส Session Token |

---

## 📦 Portable Mode (สำหรับ Windows Client)

หากต้องการนำไปใช้งานทดสอบความเร็วในหน้างานแบบ Standalone โดยไม่ต้องติดตั้ง Docker หรือ Python:
- **ดาวน์โหลดได้ทันทีจาก GitHub Releases**:
  - 📥 [**iperf3-portable-client.exe (v1.0.0)**](https://github.com/pirateszero92/iperf3-app/releases/download/v1.0.0/iperf3-portable-client.exe) — ไฟล์โปรแกรมเดี่ยว รันใช้งานได้ทันที (Single Executable)
  - 📦 [**iperf3-portable-client-v1.0.0-windows-x64.zip**](https://github.com/pirateszero92/iperf3-app/releases/download/v1.0.0/iperf3-portable-client-v1.0.0-windows-x64.zip) — ไฟล์บีบอัด Zip Archive
- ในโหมดนี้โปรแกรมจะปรับหน้าตาเป็น **iPerf3 Portable Client** ที่มีเฉพาะเครื่องมือ Client Mode และ Test History เพื่อความกะทัดรัด น้ำหนักเบา และเปิดเบราว์เซอร์ให้อัตโนมัติทันทีที่ดับเบิลคลิก

---

## 🤝 การมีส่วนร่วมและการพัฒนา (Contributing)
ยินดีต้อนรับทุกท่านที่ต้องการร่วมพัฒนา! หากพบปัญหาหรือมีข้อเสนอแนะฟีเจอร์ใหม่ สามารถสร้าง **Issue** หรือส่ง **Pull Request** ได้ทาง GitHub Repository

## 📄 ใบอนุญาต (License)
โปรเจกต์นี้เผยแพร่ภายใต้ใบอนุญาต **MIT License**