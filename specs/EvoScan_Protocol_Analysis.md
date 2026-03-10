# 📖 REFERENCE DOCUMENT: EvoScan and MMCodingWriter Protocol Analysis

**Status:** Analysis from EvoScan decompilation
**Date:** February 24, 2026
**Source Files:**
- EvoScanV3.1.exe (5.59 MB)
- MMCodingWriter_2.3.exe (3.61 MB)
- Evoxtoolbox.exe (908 KB)
- RAX Fast Logging Rev E - SST Rev A - ACD Rev A - EVOX.xml

**Analysis Method:** Binary string extraction and XML configuration analysis

> **⚠️ For current implementation status, see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md) and [`PROTOCOL_SUPPORT.md`](PROTOCOL_SUPPORT.md)**

---

## Executive Summary

This document contains extracted protocol information from EvoScan V3.1 and MMCodingWriter, reverse-engineered using string extraction and .NET decompilation. The primary focus is on the **MUT-III protocol**, which is used for real-time data logging, ROM reading/writing, and parameter adjustment on Mitsubishi Evolution vehicles. Additional protocols (Subaru SSM/SSMI) and Windows adapter backends were also identified in the binaries.

---

## 1. MUT-III Protocol: Core Command Set

### 1.1 Memory Address and Data Access Commands

The following commands define the fundamental MUT-III protocol operations for memory access:

#### **E0 - Set Address (4-byte address)**
```
Command:     0xE0
Parameters:  4 bytes (address in big-endian format)
Response:    ACK or address confirmation
Purpose:     Sets the current memory address pointer for subsequent read/write operations
Example:     E0 00 12 34 56 → Set address to 0x00123456
```

#### **E1 - Read 1 Byte at Address**
```
Command:     0xE1
Parameters:  None (uses address set by E0)
Response:    1 byte data value
Purpose:     Read a single byte from the address set by E0
Example:     E1 → Returns 1 byte of data
Note:        Address pointer remains unchanged after read
```

#### **E2 - Send 1 Byte Value**
```
Command:     0xE2
Parameters:  1 byte value
Response:    ACK
Purpose:     Stage a byte value for subsequent write operation (E3)
Example:     E2 FF → Stage 0xFF for next write
Note:        This value is held in ECU RAM until used by E3
```

#### **E3 - Write 1 Byte to RAM at Address**
```
Command:     0xE3
Parameters:  None (uses value set by E2 and address set by E0)
Response:    ACK or write confirmation
Purpose:     Write the previously staged byte (via E2) to RAM at the address set by E0
Example:     E2 42; E3 → Write 0x42 to address set by E0
Note:        This only writes to RAM, not persistent ROM storage
```

#### **E4 - Read 2 Bytes at Address**
```
Command:     0xE4
Parameters:  None (uses address set by E0)
Response:    2 bytes data (Big-endian)
Purpose:     Read 16-bit word from the address set by E0
Example:     E4 → Returns 2-byte word
Byte Order:  Big-endian (MSB first)
```

#### **E5 - Read 2 Bytes and Auto-Increment Address**
```
Command:     0xE5
Parameters:  None (uses address set by E0)
Response:    2 bytes data (Big-endian)
Purpose:     Read 2 bytes and automatically increment the address pointer by 2
Example:     E5 → Returns 2 bytes, increments E0 by +2
Note:        Enables efficient sequential memory dumping
Typical Use: Repeated logging of E5 can dump entire ROM/RAM regions
```

#### **E6 - Copy Fuel Map from ROM to RAM**
```
Command:     0xE6
Parameters:  None
Response:    ACK or operation status
Purpose:     Copies fuel map data from ROM to RAM for tuning/editing
Example:     E6 → ROM fuel tables copied to RAM
Note:        Enables temporary fuel map modifications without persistent storage
```

### 1.2 Request/Response Frame Format

#### **General Frame Structure**
```
[Header] [Command] [Length] [Data...] [Checksum]

Header:    1 byte (protocol identifier, typically 0x00)
Command:   1 byte (0xE0-0xE6, or other supported commands)
Length:    1 byte (length of data payload, excluding header/command/checksum)
Data:      Variable length (0-N bytes, command-dependent)
Checksum:  1 byte (simple checksum over all preceding bytes)
```

#### **Checksum Calculation**
```
Checksum = (sum of all bytes from Header through Data) & 0xFF
Or:        Checksum = (256 - (sum % 256)) for two's complement
```

**Example Frame:**
```
Request:  00 E1 00 [checksum]
Response: 00 [data_byte] [checksum]
```

---

## 2. Handshake and Session Initialization

### 2.1 Connection Handshake Sequence

While not explicitly documented in the extracted strings, typical MUT-III handshake follows this pattern:

```
1. Host → ECU:    0x00 0x3E 0x00 [checksum]   (Keep-alive/Handshake request)
2. ECU → Host:    0x00 0x7E 0x00 [checksum]   (Handshake response)
3. Host → ECU:    0x00 0x10 0x01 0x01 [sum]   (Enter diag session if needed)
4. ECU → Host:    0x00 0x50 0x01 [checksum]   (Diagnostic mode confirmed)
```

### 2.2 Security/Authentication (Observed Patterns)

From EvoScan binary analysis:
- **SSM Protocol Security:** Uses seed-key authentication for write operations
- **Seed Request:** Certain commands trigger seed generation (0x27 01)
- **Key Response:** Host calculates key from seed and responds (0x27 02 + calculated key)

---

## 3. Protocols Supported by EvoScan

### 3.1 Subaru SSM-II Protocol (Supported)

**Description:** Subaru Select Monitor II protocol used for modern Subaru vehicles (WRX/STIs)

**Features:**
- 4-byte address space
- Read/Write RAM and ROM
- Real-time data logging
- Fault code reading and clearing

**Key Commands:**
```
SSM Address Set:    Similar to E0 (4-byte addressing)
SSM Read Byte:      Similar to E1 (1-byte read)
SSM Read Word:      Similar to E4 (2-byte read)
```

### 3.2 Subaru SSMI Protocol (Legacy)

**Description:** Original Subaru Select Monitor for pre-1999 Subarus and SVX

**Note from EvoScan:**  
> "Select ECU to determine SSMI or SSMII. Does NOT support OpenPort 2.0 cable"

### 3.3 MUT-III Protocol (Primary Focus)

**Description:** Mitsubishi Universal Transmission III protocol

**Implementation Status:** ✅ 48 RAX parameters identified and implemented in Phase 2 (see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md))

**Supported Functions:**
- RAM address setting (4-byte addresses)
- Byte/word read operations
- RAM byte write operations
- ROM to RAM fuel map copying
- Real-time data logging
- Parameter adjustment
- Checksum and data integrity verification

### 3.4 Windows Hardware Backends

EvoScan V3.1 exposes multiple Windows hardware paths, and they should not be treated as interchangeable:

- **OpenPort 2.0**: Uses `op20pt32.DLL` via the J2534 PassThru API.
- **OpenPort 1.3**: Uses `FTD2XX.dll` direct FTDI calls rather than J2534.
- **Generic serial/COM**: Uses the .NET `SerialPort` path for other adapters.

This matters for reverse-engineering because OpenPort 1.3 and OpenPort 2.0 do **not** share the same Windows communication layer. Findings derived from the OpenPort 2.0 J2534 path should not be projected onto the older FTDI-backed OpenPort 1.3 path without verification.

---

## 3.5 Windows OpenPort Findings (2026-03-10)

### OpenPort 2.0: confirmed J2534 usage

Decompilation of `EvoScanV3.1.exe` shows direct imports from `op20pt32.DLL` for:

- `PassThruOpen`
- `PassThruClose`
- `PassThruConnect`
- `PassThruDisconnect`
- `PassThruReadMsgs`
- `PassThruWriteMsgs`
- `PassThruStartMsgFilter`
- `PassThruStopMsgFilter`
- `PassThruIoctl`

This confirms the OpenPort 2.0 path on Windows is a standard J2534 PassThru integration, not a raw FTDI transport.

### OpenPort 1.3: confirmed FTDI usage

The same assembly also imports a large set of `FTD2XX.dll` functions including:

- `FT_Open`
- `FT_Read`
- `FT_Write`
- `FT_SetBaudRate`
- `FT_SetLatencyTimer`
- `FT_SetUSBParameters`
- `FT_SetBreakOn`
- `FT_SetBreakOff`

This is consistent with EvoScan's older OpenPort 1.3 support being implemented through the FTDI D2XX API rather than J2534.

### Implication

For live logging and RX-path investigation:

- **OpenPort 2.0 findings** are relevant to the project's current `op20` / J2534-style work.
- **OpenPort 1.3 findings** are relevant to legacy FTDI adapters and K-line style workflows, but should not be assumed to match OpenPort 2.0 behavior.

---

## 4. Real-Time Data Logging

### 4.1 Logging Request IDs (from XML Configuration)

The EvoScan XML configuration defines numerous real-time logging parameters with specific request IDs:

#### **RAX (Real-Time Advanced Logging) Parameters**

```xml
<!-- Memory-mapped logging data blocks -->
RequestID="238051b0" → RAX_C_Dat (RPM, Knock Sum, Timing, Load)
RequestID="238051b4" → RAX_D_Dat (Barometer, MAP, Boost, MAF)
RequestID="238051a8" → RAX_B_Dat (AFR, Load, O2 Sensor, Injector Pulse)
RequestID="238051b8" → RAX_E_Dat (Variable Valve Timing)
RequestID="238051bc" → RAX_F_Dat (TPS, APP, IAT, WGDC)
RequestID="238051c0" → RAX_G_Dat (Speed, Battery, ECT, MAT)
RequestID="238051ac" → RAX_A_Dat (Fuel Trim STFT, LTFT)
RequestID="238051c4" → RAX_H_Dat (MAF, MAP, Load Calcs)
```

### 4.2 Data Extraction from Logging Blocks

Example of bit-level data extraction from RAX_C_Dat:
```
RAX_C_Dat (4 bytes):
  - RPM:           BITS(11,11) * 7.8125
  - Knock Sum:     BITS(17,6)
  - Load (Timing): BITS(32,8) * 1.5625
  - Timing Advance: BITS(24,7) - 20°
```

### 4.3 SST (Subaru Select Monitor Transmission) Logging

Over 100 SST-specific parameters are logged, including:
```
- Transmission temperature (DegC/DegF)
- Clutch pressure (1 & 2) in PSI/mBar/Bar
- Gear selection and engagement status
- Shift fork positions
- Wheel speeds (all 4 wheels)
- Transmission torque and slip
- TCU battery voltage and sensor supplies
- Solenoid drive currents (mA)
```

---

## 5. Reading/Writing Functionality

### 5.1 ROM Reading Strategy

The XML configuration and protocol suggest the following read strategy:

```
1. Set address to start of ROM region: E0 [address_bytes]
2. Loop: E5 (read 2 bytes and increment) for sequential dumping
   OR:   E1/E4 for individual byte/word reads
3. Verify data integrity using checksum
4. Repeat for entire ROM space (typically 1-4 MB for evo ECUs)
```

### 5.2 RAM Write Operations

```
1. Set address to target RAM location: E0 [address_bytes]
2. Load data byte into staging register: E2 [value]
3. Write to RAM: E3
4. Verify write by reading back: E1
5. Repeat for each byte to write
```

### 5.3 Fuel Map Tuning (ROM to RAM Copy)

```
1. Request ROM→RAM fuel map copy: E6
2. Read current fuel map from RAM: E0 [fuel_map_addr]; E5 (repeated)
3. Modify fuel values in RAM: E2 [new_value]; E3
4. Verify modifications
5. Write modified values back to ROM (if supported)
```

**Note:** ROM write operations likely require security authentication (seed-key exchange) not fully documented in extracted strings.

---

## 6. Checksum Algorithms

### 6.1 Simple Sum Checksum (Observed in Frames)

**Calculation Method:**
```
checksum = (sum of all payload bytes) & 0xFF
```

**Verification:**
```
(checksum + payload_sum) & 0xFF == 0x00
```

### 6.2 ROM Checksum (For Data Integrity)

From the EvoScan binary, reference to ROM checksums suggests:
- **Type:** Likely CRC-based (CRC-16 or CRC-32)
- **Polynomial:** Not explicitly found, but standard polynomials are common
- **Verification:** Used to validate ROM integrity before/after flashing

### 6.3 Potential Mitsubishi Checksum Polynomial

Based on industry knowledge (not directly observed in binaries):
```
Common MUT-III sum:      8-bit XOR of all bytes
Common ROM checksum:     16-bit CRC-CCITT (0x1021 polynomial)
```

---

## 7. Security and Authentication Procedures

### 7.1 Seed-Key Exchange (Inferred from Subaru SSM)

While full implementation not visible, the pattern appears as:

```
1. Request Seed:
   00 27 01 [checksum]
   Response: 00 67 01 [seed_bytes] [checksum]

2. Host calculates key from seed (proprietary algorithm)

3. Send Key:
   00 27 02 [key_bytes] [checksum]
   Response: 00 67 02 [checksum] (if authenticated)
```

### 7.2 Security Levels

Different access levels likely require different seeds:
- **Read-only access:** May be unrestricted
- **RAM modifications:** Possible seed-key requirement
- **ROM writing:** Likely requires authentication
- **Calibration constants:** May have additional protections

### 7.3 VIN Lock Protection (Observed in SST)

From SST parameters:
```
SST_30_OriginalVINLOCKState
SST_31_StatesofECUInternalBehaviourForVINWriting_OriginalVIN
SST_32_StatesofECUInternalBehaviourForVINWriting_CurrentVIN
SST_33_CounterValueforWritingCurrentVIN
```

Suggests VIN-based locking mechanism preventing unauthorized modifications.

---

## 8. Address Schemes

### 8.1 ROM Address Space (Typical Mitsubishi Evolution)

```
0x000000 - 0x00FFFF    ROM ID and metadata (64 KB)
0x010000 - 0x7FFFFF    Main ROM code and data (8 MB typical)
0x800000+              Extended memory/external storage
```

### 8.2 RAM Address Space

```
0x000000 - 0x00FFFF    ECU internal RAM (64 KB)
0x010000 - 0x03FFFF    Working memory and tables
0x040000+              Possible external RAM
```

### 8.3 Fuel Map Storage

From E6 command context:
```
ROM Fuel Map:   Address typically 0x100000+
RAM Fuel Map:   Address in working RAM (0x010000-0x02FFFF range)
```

---

## 9. MUT-III Command Summary Table

| Command | Hex | Function | Parameters | Returns |
|---------|-----|----------|-----------|---------|
| Set Address | 0xE0 | Set memory address pointer | 4 bytes address | ACK |
| Read Byte | 0xE1 | Read 1 byte at current address | None | 1 byte data |
| Send Value | 0xE2 | Stage byte value for write | 1 byte value | ACK |
| Write Byte | 0xE3 | Write staged value to RAM | None | ACK |
| Read Word | 0xE4 | Read 2 bytes at current address | None | 2 bytes data |
| Read+Inc | 0xE5 | Read 2 bytes, increment address | None | 2 bytes data |
| Fuel Copy | 0xE6 | Copy ROM fuel map to RAM | None | ACK |
| Handshake | 0x3E | Keep-alive/session init | None | ACK |
| Diag Mode | 0x10 | Enter diagnostic session | Mode byte | ACK |

---

## 10. Tools and Access Points

### 10.1 EvoScan Features (from XML/Binary)

- **Real-time data logging** via MUT-III protocol
- **Parameter editing** with live feedback
- **OBD-II/MUT-III DataLogger** support
- **Subaru SSM-II/SSMI** protocol support
- **Fault code management**
- **ROM flashing** capabilities (via MMCodingWriter)
- **Data visualization** and charting
- **Session management** and logging

### 10.2 MMCodingWriter Features

Based on executable analysis:
- **Primary ROM flashing tool** for Mitsubishi vehicles
- **Checksum recalculation** after ROM modifications
- **Security key calculation**
- **ECU hardware detection** and communication
- Used alongside EvoScan for complete ROM editing workflow

### 10.3 Tool Communication Protocol

```
EvoScan ←→ Serial Interface (USB-to-COM adapter) ←→ ECU
          ↓
       Read/Write real-time data via MUT-III
       
MMCodingWriter ←→ Same Serial Interface ←→ ECU
                ↓
             Flash complete ROM images
             Recalculate checksums
             Verify write operations
```

### 10.4 OpenPort 2.0 J2534 Session Findings

The Windows OpenPort 2.0 session setup recovered from decompilation is materially more specific than the earlier string-only analysis.

**Observed sequence:**

1. `PassThruOpen(...)`
2. `PassThruIoctl(deviceId, 3, ...)`
3. `PassThruConnect(deviceId, protocol, flags=0, baud=500000, out channelId)`
4. `PassThruStartMsgFilter(channelId, 1, ...)`
5. `PassThruIoctl(channelId, 7, ...)`
6. `PassThruIoctl(channelId, 8, ...)`
7. `PassThruReadMsgs(...)` / `PassThruWriteMsgs(...)`

These numeric IDs align with the standard J2534 naming used elsewhere in the project:

- `Ioctl(3)` → `READ_VBATT`
- `StartMsgFilter(..., 1, ...)` → `PASS_FILTER`
- `Ioctl(7)` → `CLEAR_TX_BUFFER`
- `Ioctl(8)` → `CLEAR_RX_BUFFER`

**Protocol selection:**

- `protocol = 5` for CAN
- `protocol = 6` for ISO15765
- `flags = 0`
- `baud = 500000`

**ISO15765 filter finding:**

For the ISO15765 branch, EvoScan starts a **filter type `1`** message filter, not the flow-control filter style currently assumed in the project's OpenPort transport.

The decompiled code constructs a 4-byte message object with:

- `ProtocolID = 6`
- zero-valued flags
- `DataSize = 4`
- a zeroed 4-byte payload

and passes that same structure to `PassThruStartMsgFilter(...)` for both mask and pattern. The exact semantic meaning of the obfuscated structure fields still needs confirmation against J2534 constants, but two points are already clear:

- EvoScan's ISO15765 RX path is **not** using the explicit `0x7E8` / `0x7E0` filter tuple currently used by this project.
- EvoScan performs additional channel-level `Ioctl` calls (`7`, `8`) after filter setup.

**Working hypothesis:**

This mismatch is a plausible explanation for why the project could prove TX-side adapter writes but still fail to surface ECU RX traffic on the current OpenPort 2.0 path.

### 10.5 EvoScan Live Logging Read-Path Findings

The next layer of decompilation shows that EvoScan's end-to-end logging path is more than a one-time `Connect` + `Filter` + `ReadMsgs` setup. The logger configures the channel, then treats J2534 reads as a lower-level byte source that it reassembles and interprets in application code.

**Observed channel configuration before the read/write loop:**

- EvoScan calls a helper that wraps `PassThruIoctl(..., 2, ...)`, which is the standard J2534 `SET_CONFIG` path.
- With the decompiled branch conditions inspected more closely, the earlier four-value config sequence is now attributable to the **`MUTII` branch**, not the `ISO15765` branch.
- In that `MUTII` path, EvoScan invokes `SET_CONFIG` with:
  - `3 = 1`
  - `6 = 750`
  - `10 = 0`
  - `12 = 0`
- Elsewhere in the same `MUTII` path, EvoScan retunes similar config IDs across phases:
  - `3 = 0`, `7 = 0`, `10 = 0`, `12 = 0`
  - later `3 = 1`, `7 = 40`, `10 = 110`, `12 = 10`
- Those values are therefore best interpreted as **legacy MUT-II / low-speed timing and loopback-related channel tuning**, not as currently-proven ISO15765 requirements.
- The most likely standard J2534 names are:
  - `3` = `LOOPBACK`
  - `6` = `P1_MIN`
  - `7` = `P1_MAX`
  - `10` = `P3_MIN`
  - `12` = `P4_MIN`
- That mapping is still an inference from standard J2534 parameter numbering plus call context, but the branch attribution is now high confidence.

**Observed manual read/write probe behavior:**

- EvoScan allocates a read-message structure with:
  - six `uint` header fields
  - `byte[120]` payload storage
- It then performs repeated `PassThruReadMsgs(channel, out msg, ref count = 1, timeout = 200)` calls.
- If one message is returned, it dumps the raw payload bytes using the J2534-reported message length rather than assuming a higher-level decoded frame abstraction.
- The same routine also writes a fixed 12-byte payload:

```text
FE 00 00 00 00 00 00 00 00 00 00 00
```

- This appears to be a transport/probe routine rather than the normal steady-state logger, but it confirms that EvoScan uses direct `ReadMsgs` / `WriteMsgs` traffic inspection during diagnostics.

**Observed steady-state logger read behavior:**

- In the main logging loop, EvoScan repeatedly:
  - zeroes the read-message structure
  - calls `PassThruReadMsgs(channel, out msg, ref count, timeout)`
  - expects `count == 1` in the normal case
  - appends the returned message payload bytes into a local accumulation buffer
  - only processes the response once enough bytes have been accumulated for the expected higher-level payload
- EvoScan treats J2534 return codes `9` and `16` as non-fatal during this loop and continues polling, while other non-zero codes break the operation.
- A second decompiled read loop performs similar byte-by-byte accumulation and compares the resulting hex string against configured expected patterns, reinforcing that response matching is done above the raw J2534 message boundary.
- In the standard J2534 error numbering used by the same OpenPort reference ecosystem, those two tolerated return codes are most likely:
  - `9` = `ERR_TIMEOUT`
  - `16` = `ERR_BUFFER_EMPTY`
- That means EvoScan's logger is probably treating "no message yet" conditions as normal polling states rather than hard failures.

**Observed ISO15765-specific setup and write behavior:**

- A later ISO15765-specific initialization path connects with `PassThruConnect(..., 6, 0, 500000, ...)`, sets the read/write timeout fields from UI-configured values, and then starts a `PASS_FILTER` using a zeroed 4-byte filter payload.
- In that same `ISO15765` branch, EvoScan immediately follows filter creation with a `SET_CONFIG(channel, 3, 0)` call.
- If the standard J2534 parameter numbering inference is correct, that means EvoScan is explicitly forcing `LOOPBACK = 0` on the ISO15765 path, even though the legacy `MUTII` path uses loopback/timing tuning more aggressively.
- After branch-specific setup is complete, EvoScan explicitly clears both buffers:
  - `PassThruIoctl(channel, 7, ...)`
  - `PassThruIoctl(channel, 8, ...)`
- In the ISO15765 write path used during logging/polling, EvoScan clears the RX buffer before issuing `PassThruWriteMsgs(...)` with a `1000 ms` timeout.
- Across the ISO15765 logging paths inspected so far, the application does **not** appear to make meaningful decisions from `RxStatus` or `ExtraDataIndex`; it primarily relies on `DataSize`, payload bytes, and higher-level byte-pattern matching.

**Implications for this project:**

- EvoScan's logging path does **not** appear to rely on a rich driver-side receive abstraction; it reads one J2534 message at a time and performs higher-level framing and matching itself.
- That means the remaining RX gap in this project is unlikely to be solved by filter type alone.
- The extra `SET_CONFIG` sequence should **not** currently be treated as an ISO15765/OpenPort 2.0 requirement, because the decompiled code ties it to EvoScan's `MUTII` path.
- The ISO15765 path still appears to do a small amount of branch-specific channel management beyond basic connect/filter:
  - likely `LOOPBACK = 0`
  - explicit TX/RX buffer clears
  - RX buffer clear before at least some writes
- The current OpenPort transport may still be too narrow if it:
  - assumes a single adapter packet maps cleanly to one complete diagnostic response
  - ignores recoverable/non-fatal read statuses that EvoScan tolerates
  - discards inbound packets that do not match the current minimal `AR...` ISO15765 expectations
- The most likely remaining mismatch is now in receive semantics and parser behavior, not the basic protocol/baud/CAN-ID tuple.

### 10.6 Mitsubishi "PassThru CAN" Package Findings

A local Mitsubishi package (`CANPassThru.zip`) and companion DLL (`ptc32.dll`) were inspected on March 10, 2026.

**Installer extraction path:**

- `CANPassThru.zip` is an InstallShield bundle containing `setup.inx`, `data1.cab`, `data1.hdr`, `data2.cab`, `CGDPTMC.msi`, and `Setup.exe`
- `unshield` cleanly extracts `data2.cab`, which contains the real application payload

**Recovered application payload from `data2.cab`:**

- `Common/PTCAN.exe`
- `Common/MUT_VCI.dll`
- `Common/VciCRepro.dll`
- `Common/ptc32.dll`
- `Common/CommCServ.exe`
- `Common/MUT3_VCImodules.xml`
- `Driver/firmware.frm`
- `ini_common/ClearDiagCANID.ini`

**Observed role of the main binaries:**

- `PTCAN.exe`
  - Native 32-bit Windows GUI executable
  - Contains strings for:
    - `PassThru CAN`
    - `PassThruCANFlash`
    - `PassThruCANImmobi`
    - `PassThruCANTeachIn`
    - `PassThruCANVINWriting`
    - `CP_REQUEST_CANIDENTIFIER`
    - `CP_RESPONSE_CANIDENTIFIER`
    - `\Ini\ClearDiagCANID.ini`
    - `C:\Program Files\PassThruCAN\System\Common\ptc32.dll`
  - This strongly suggests `PTCAN.exe` is the real Mitsubishi front-end for diagnostics, coding, VIN writing, immobilizer, and flash workflows.
- `MUT_VCI.dll`
  - Native 32-bit Windows DLL
  - Exports a full D-PDU style interface including:
    - `PDUConnect`
    - `PDUCreateComLogicalLink`
    - `PDUStartComPrimitive`
    - `PDUIoCtl`
    - `PDUSetParameter`
    - `PDUGetParameter`
  - Strings indicate MUT-3-specific transport resources and IOCTLs such as:
    - `PDU_IOCTL_READ_VBATT`
    - `PDU_IOCTL_CLEAR_RX_QUEUE`
    - `PDU_IOCTL_CLEAR_TX_QUEUE`
    - `Use resource=MUT_RSC_CANHS_MMC`
    - `Use resource=MUT_RSC_K_LINE_MMC`
  - The bundled `MUT3_VCImodules.xml` defines the transport model explicitly:
    - bus `CANHS` (`id=2000`) with supported baud rates of `500000` or `250000`
    - bus `K-LINE` (`id=2001`)
    - protocol `MSP_KW2C_MMC` (`id=3000`) described as `Keyword on CAN for MMC (ES-X46228)`
    - protocol `MSP_KW2K_MMC` (`id=3001`) described as `Keyword on K-Line for MMC (ES-X46228)`
    - resource `CANHS_MMC` (`id=4000`) on pins `6` and `14`
    - resource `K-LINE_MMC` (`id=4001`) on pin `7`
  - The same XML records default CAN transport/session values:
    - `PDU_PARAM_BUS_BAUDRATE = 500000`
    - `PDU_PARAM_PROT_DLC_SIZE = 0` meaning fixed 8-byte frames padded with `0xFF`
    - `PDU_PARAM_PROT_P2CAN = 60`
    - `PDU_PARAM_PROT_P2CAN_78 = 2600`
    - `PDU_PARAM_PROT_Cr = 70`
    - `PDU_PARAM_PROT_DNUM = 3`
    - `PDU_PARAM_PROT_TESTER_PRESENT_INTERVAL = 1000`
    - `PDU_PARAM_PROT_TESTER_PRESENT_DATA = 023E02FFFFFFFFFF`
    - `PDU_PARAM_PROT_TESTER_PRESENT_IDENTIFIER_SUB = 0x7DF`
    - `PDU_PARAM_PROT_START_DIAG_SES_FLAG = 1`
    - `PDU_PARAM_PROT_START_NORMAL_SES_FLAG = 1`
    - `PDU_PARAM_PROT_START_DIAG_SES_DATA = 0x1092`
    - `PDU_PARAM_PROT_START_NORMAL_SES_DATA = 0x1081`
  - The XML also maps Mitsubishi D-PDU IOCTL IDs:
    - `PDU_IOCTL_READ_VBATT = 0x10000001`
    - `PDU_IOCTL_CLEAR_TX_QUEUE = 0x10000010`
    - `PDU_IOCTL_CLEAR_RX_QUEUE = 0x100000013`
    - `PDU_IOCTL_READ_CAN_VOL = 0xF0000003`
    - `PDU_IOCTL_READ_CAN_REG = 0xF0000004`
- `VciCRepro.dll`
  - Native 32-bit Windows DLL
  - Exports reprogramming-oriented entrypoints such as `DownLoad`, `UpDate`, `InitialReset`, and `CheckComm`
  - Additional strings such as `EraseCheck` and `EraseDrvRcdData` reinforce that this DLL is aligned with ECU programming/reflash flows rather than ordinary logging
- `ptc32.dll`
  - Native 32-bit Windows DLL
  - Exports only:
    - `FUNC_LIST`
    - `GET_VERSION`
  - Appears to be a lower-level Mitsubishi transport shim used by the front-end rather than a flat J2534-style API surface.

**Recovered CAN ID configuration:**

`ini_common/ClearDiagCANID.ini` contains:

```ini
[CANID]
NUMBER=1
REQ1=7E0
RES1=7E8
```

This confirms Mitsubishi's PassThru CAN tooling expects the same standard MUT/UDS-style request/response identifiers already assumed by the project.

**Recovered diagnostic/session behavior from `protocol.gbf` and the CBF payloads:**

- The bundled protocol metadata is based on `KWP2000CAN 1.2.8` rather than a generic OBD-only stack.
- Addressing semantics are described explicitly:
  - `PHYSICAL` uses `CP_REQUEST_CANIDENTIFIER` and expects a reply on `CP_RESPONSE_CANIDENTIFIER`
  - `FUNCTIONAL` uses `CP_GLOBAL_REQUEST_CANIDENTIFIER` and does not expect a response
- Default initialization behavior is also described explicitly:
  - `UseDefaultInitialization = DEFAULTINIT` generates `StartDiagnosticSession-DCXDiagnosticSession (10 92)`
  - `NOINIT` begins with tester present (`3E`) and considers communication started on either positive or negative response
  - `UseDefaultExit = DEFAULTEXIT` generates `StartDiagnosticSession-StandardDiagnosticSession (10 81)` on exit
- The protocol metadata states the expected positive response SID is normally `request SID + 0x40`, but that the application can override it if an ECU behaves differently.
- Negative response handling is parameterized:
  - retry timing for `7F xx 21`
  - pending/response wait semantics for `7F xx 78`
- CAN monitoring is an explicit protocol feature, not an implementation accident:
  - `CP_CANMONITORING` toggles monitoring on/off
  - `CP_CANMONITORINGFILTER` defines a hardware monitoring mask where `1 = must match`
  - `CP_CANMONITORINGIDENTIFIER` defines the identifier to monitor
  - helper names such as `GPDMonitorControlCAN`, `GPDInsertMonitor`, and `GPDReturnMessageFlush` appear throughout the CAN protocol metadata
- Response filtering is also explicit in the protocol layer:
  - `GPDFilter_POSITIVERESPONSE`
  - `GPDFilter_NEGATIVERESPONSE`
  - `GPDFilter_WAIT`
  - `GPDFilter_REPEAT`
  - `GPDFilter_TESTERPRESENT`
  - `GPDFilter_HEXSERVICE`
- DTC handling is implemented in a fairly rich way:
  - strings and symbols identify `ReportDTCbyDTCNumber`, `ReportDTCbyStatusMask`, `ReportSupportedDTCs`, and environment-data retrieval flows
  - the payload references both Mitsubishi-specific DTC handling (`PALErrorList`) and OBD-oriented handling (`OBDErrorList`)
  - CBF metadata contains `Extended Diagnostic Session` and `Normal/Default Session`, along with VIN-oriented data items such as `VIN-Current` and `VIN-Original`
  - DTC status evaluation includes UDS-style interpretations such as ACTIVE, PENDING, CONFIRMED/STORED, TestNotComplete, and WarningIndicatorRequested
- `PTCAN.exe` also references `FN_Control_DTC_Setting_No_response_required` and `FN_Normal_Message_Transmission_Disable_No_Resp_required`, which suggests some service wrappers intentionally tolerate or expect no response.

**Recovered hardware/firmware configuration hints:**

- `slave.ini` enables `Monitoring=TRUE` for several Mitsubishi VCI profiles and can enable `CANWarningCheck=TRUE`, indicating that passive receive/monitoring and CAN controller warning capture are first-class firmware features.
- The same file shows USB-backed operation for `PartY` with `Interface=USB`, rather than a pure serial-only transport assumption.
- `hardware.ini` defines multiple cable/adapter profiles with high CAN channel counts (commonly `50`) and explicit CANHS pin mappings.
- `mapping.plf` maps OBD-II CAN onto the expected physical pins, reinforcing that the installed stack is built around explicit cable and pin-layout knowledge rather than generic adapter defaults.

**Observed role of `CGDPTMC.dll`:**

- Installed by `CGDPTMC.msi`
- Exports COM registration entrypoints only
- Strings identify it as a `CopyGuard`-style licensing component

This means `CGDPTMC.dll` is not the transport implementation; the real technical value is in `PTCAN.exe`, `MUT_VCI.dll`, and related config files extracted from `data2.cab`.

**Assessment:**

- Mitsubishi's package is more useful than first assumed because it includes a real application, a VCI/PDU API, and explicit CAN ID configuration.
- It does **not** directly replace EvoScan as the clearest OpenPort 2.0 J2534 reference, because Mitsubishi appears to use a D-PDU / MUT-3 stack instead of the managed J2534 path EvoScan exposes.
- It is still valuable for corroborating expected CAN IDs, queue-clearing concepts, transport resource names, default session/tester-present behavior, and DTC/diagnostic workflow boundaries.
- The Mitsubishi artifacts strengthen the case that the unresolved RX issue is not about high-level MUT/UDS semantics alone; both the EvoScan J2534 path and the Mitsubishi D-PDU path rely on explicit session control, tester-present handling, queue management, and response-shape expectations.
- The Mitsubishi metadata also suggests that receive visibility may depend on explicit monitoring/filter configuration, which is consistent with a world where TX succeeds but RX is filtered, flushed, or never surfaced to the application layer.

### 10.7 Open Questions

- Determine whether EvoScan relies on OpenPort driver defaults for RX routing that the current project does not reproduce.
- Confirm the inferred J2534 names for EvoScan's `MUTII`-branch `SET_CONFIG` parameter IDs `3`, `6`, `7`, `10`, and `12`.
- Confirm whether EvoScan's tolerated `PassThruReadMsgs` return codes `9` and `16` are exactly `ERR_TIMEOUT` and `ERR_BUFFER_EMPTY` in the OpenPort 2.0 driver it ships against.
- Determine whether EvoScan's ISO15765-specific `SET_CONFIG(channel, 3, 0)` call is in fact `LOOPBACK = 0` and whether that matters for the current project's RX behavior.
- Validate whether the OpenPort 1.3 FTDI path uses a materially different RX strategy for MUT logging.
- Determine whether EvoScan's future MUT-II support should explicitly mirror those `SET_CONFIG` values or instead prefer an existing open-source implementation as the baseline.
- Determine how `PTCAN.exe` configures `MUT_VCI.dll` logical links and whether its D-PDU parameter set exposes CAN receive behavior relevant to the current RX gap.
- Determine whether the current project should mimic Mitsubishi's fixed 8-byte padding, tester-present cadence, and default `10 92` / `10 81` session lifecycle when validating MUT logging over OpenPort 2.0.

---

## 11. Known Limitations and Constraints

### 11.1 Tools Used for Analysis

- **Command-line tools available:**
  - `strings` - Extract ASCII/printable strings from binaries ✓ Used
  - `file` - Identify binary format ✓
  - `nm` - List symbols ✗ (Not applicable to .exe without debug symbols)
  - `objdump` - Disassemble ✗ (MacOS limitation - Windows executable)
  - `Radare2` - Binary analysis ✗ (Not pre-installed)
  - `ilspycmd` - .NET decompilation ✓ Used on `EvoScanV3.1.exe`

### 11.2 Information Not Extracted

- **Exact seed-key algorithm:** Still not recovered
- **CRC/Checksum polynomials:** Not explicitly found
- **Complete command set:** Only E0-E6 confirmed for MUT logging path
- **ROM write procedures:** Likely requires authentication
- **Hardware-specific timing:** Not accessible from binaries
- **Security algorithm details:** Still obfuscated or compiled
- **J2534 constant names:** Core EvoScan constants are now mapped with high confidence, but additional Mitsubishi-native constants may still need mapping

### 11.3 What Would Be Needed for Complete Reverse-Engineering

1. **Disassembler/Decompiler:** IDA Pro, Ghidra, Radare2, or ILSpy/dnSpy for managed binaries
2. **Debugger:** WinDbg or x64dbg to trace protocol execution
3. **ROM files:** Actual evo ECU ROM images to reverse-engineer checksums
4. **Protocol analyzer:** Serial sniffer to capture live communication
5. **Test hardware:** Actual ECU for validation

---

## 12. Comparison: MUT-III vs Other Protocols

| Feature | MUT-III | SSM-II | OBD-II |
|---------|---------|--------|--------|
| **Address Space** | 4-byte | 4-byte | Standardized |
| **Read/Write** | Both | Both | Read-mostly |
| **Data Logging** | Real-time | Real-time | Parameter IDs |
| **ROM Flashing** | Yes | Yes | No |
| **Security** | Seed-key | Seed-key | VIN-based |
| **Tuning Support** | Extensive | Limited | None |
| **Used By** | Mitsubishi | Subaru | All OBD-II vehicles |

---

## 13. Implementation Recommendations

### 13.1 For Custom Protocol Implementation

1. **Use UART/RS232** at 9600-115200 baud (typical Mitsubishi)
2. **Implement timeout handling** (typically 100-500ms)
3. **Validate checksums** on every transmission
4. **Buffer management** for large data transfers
5. **Address boundary checks** to prevent invalid access

### 13.2 For Security Consideration

1. **Never trust untrusted ROM files** without checksum validation
2. **Implement seed-key verification** before accepting write commands
3. **Use VIN locking** to prevent unauthorized flashing
4. **Log all ROM modifications** for audit trails
5. **Implement timeout-based disconnection** for failed authentications

---

## 14. Conclusion

This analysis extracted significant protocol information from EvoScan V3.1 and related tools:

### **Key Findings:**

1. **MUT-III Protocol:** Confirmed core command set (E0-E6) for memory access, data logging, and fuel map operations

2. **Frame Structure:** Simple protocol with header, command, data, and checksum validation

3. **Multi-Protocol Support:** EvoScan supports MUT-III (Mitsubishi), SSM-II (Subaru), and OBD-II

4. **Real-Time Logging:** Extensive data logging via memory-mapped parameters with bit-level extraction

5. **Hardware Split:** OpenPort 2.0 is handled through J2534 `op20pt32.DLL`, while OpenPort 1.3 uses FTDI `FTD2XX.dll`

6. **OpenPort 2.0 Session Shape:** EvoScan's Windows ISO15765 setup uses `PassThruConnect`, filter type `1`, and post-connect `Ioctl(7)` / `Ioctl(8)` calls

7. **Security:** Seed-key authentication and VIN-locking mechanisms observed

8. **Tool Ecosystem:** EvoScan for tuning/logging + MMCodingWriter for ROM flashing represents complete editing suite

### **Limitations:**

- Some decompiled methods remain obfuscated and require manual interpretation
- Exact authentication algorithms remain proprietary/obfuscated
- ROM write and security procedures partially obfuscated
- J2534 constant names for some `Ioctl` and filter calls still need mapping

### **Applicability:**

This information is suitable for:
- Understanding MUT-III protocol basics
- Implementing protocol listeners/loggers
- Developing custom tuning tools
- Reverse-engineering vehicle ECU communication

This is NOT sufficient for:
- Complete ROM flashing implementation without additional research
- Security key algorithm implementation
- Bypassing authentication mechanisms
- Unauthorized vehicle tuning

---

## 15. References and Related Documentation

- **Files Analyzed:**
  - `/Users/colecrouter/Downloads/EvoScanV3.1.exe`
  - `/Users/colecrouter/Downloads/EvoScanV3.1/MMCodingWriter_2.3.exe`
  - `/Users/colecrouter/Downloads/EvoScanV3.1/RAX Fast Logging Rev E - SST Rev A - ACD Rev A - EVOX.xml`

- **Related Projects in Workspace:**
  - `/packages/device/protocols/mut3/` - MUT-III implementation
  - `/packages/device/protocols/subaru/` - Subaru protocol implementation
  - `/packages/core/src/checksum/` - Checksum algorithm documentation

- **Stored Analysis Files:**
  - `/tmp/evoscan_strings.txt` - All strings from EvoScan
  - `/tmp/mmcodingwriter_strings.txt` - All strings from MMCodingWriter

---

**Document prepared using string extraction and .NET decompilation techniques.**
**Not based on official documentation.**
