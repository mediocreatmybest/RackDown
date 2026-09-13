export const DEFAULT_SOURCE = `rack "Comms Rack" 12U 19in u1 bottom views front rear

12 ubiquiti-unifi-dream-machine-pro "Gateway" as gateway
11 ubiquiti-unifi-switch-pro-hd-24-poe "Core PoE" as core
9 dell-poweredge-r740 "PVE01" as pve1
6.5 0.5U device "Tiny Device" as tiny
rear 4 pdu "PDU A" as pdu-a

core:25 -- gateway:10 fibre
core:1 -- pve1:iDRAC9
gateway:9 -- [[ISP Handover]]`;
