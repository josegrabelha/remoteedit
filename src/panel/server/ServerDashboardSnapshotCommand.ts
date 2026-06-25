export function buildServerDashboardSnapshotCommand(): string {
  return String.raw`remote_edit_print() {
remote_edit_key="$1"
shift
remote_edit_value="$*"
remote_edit_value=$(printf '%s' "$remote_edit_value" | tr '\r\n' '  ')
printf '%s=%s\n' "$remote_edit_key" "$remote_edit_value"
}
remote_edit_cmd_exists() { command -v "$1" >/dev/null 2>&1; }
remote_edit_os=$(uname -s 2>/dev/null || printf 'unknown')
remote_edit_kernel=$(uname -r 2>/dev/null || printf '')
remote_edit_arch=$(uname -m 2>/dev/null || printf '')
if [ "$remote_edit_os" = "AIX" ]; then
remote_edit_aix_arch=$(uname -p 2>/dev/null || printf '')
if [ -z "$remote_edit_aix_arch" ] && remote_edit_cmd_exists bootinfo; then
  remote_edit_aix_arch=$(bootinfo -p 2>/dev/null || printf '')
fi
if [ -n "$remote_edit_aix_arch" ]; then
  remote_edit_arch="$remote_edit_aix_arch"
fi
fi
remote_edit_host=$(hostname 2>/dev/null || uname -n 2>/dev/null || printf '')
remote_edit_user=$(whoami 2>/dev/null || id -un 2>/dev/null || printf '')
remote_edit_id=$(id 2>/dev/null || printf '')
remote_edit_home=$HOME
remote_edit_shell=$SHELL
remote_edit_server_time=$(date '+%Y-%m-%d %H:%M %z' 2>/dev/null || printf '')
if [ -z "$remote_edit_server_time" ]; then
remote_edit_server_time=$(date '+%Y-%m-%d %H:%M' 2>/dev/null || printf '')
fi
if [ -z "$remote_edit_server_time" ]; then
remote_edit_server_time=$(date 2>/dev/null || printf '')
fi
remote_edit_format_network_addresses() {
awk '
  function valid_ipv4(value, parts) {
    if (value !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) return 0;
    split(value, parts, ".");
    for (i = 1; i <= 4; i++) {
      if (parts[i] < 0 || parts[i] > 255) return 0;
    }
    return value != "127.0.0.1";
  }
  {
    item=$0;
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", item);
    if (item == "") next;
    address=item;
    sub(/^.*: /, "", address);
    if (!valid_ipv4(address)) next;
    if (seen[address]++) next;
    values[++count]=item;
    if (count >= 5) exit;
  }
  END {
    for (i=1; i<=count; i++) printf "%s%s", (i > 1 ? ", " : ""), values[i];
  }
'
}
remote_edit_network_addresses=''
if remote_edit_cmd_exists ip; then
remote_edit_network_addresses=$(ip -o -4 addr show scope global 2>/dev/null | awk '{ iface=$2; addr=$4; sub(/\/.*/, "", addr); if (iface != "" && addr != "") print iface ": " addr; }' | remote_edit_format_network_addresses)
fi
if [ -z "$remote_edit_network_addresses" ] && remote_edit_cmd_exists hostname; then
remote_edit_network_addresses=$(hostname -I 2>/dev/null | awk '{ for (i=1; i<=NF; i++) print $i }' | remote_edit_format_network_addresses)
fi
if [ -z "$remote_edit_network_addresses" ] && remote_edit_cmd_exists ifconfig; then
remote_edit_network_addresses=$(ifconfig -a 2>/dev/null | awk '
  /^[^[:space:]].*:/ {
    iface=$1;
    sub(/:.*/, "", iface);
  }
  /[[:space:]]inet[[:space:]]/ || /inet addr:/ {
    addr="";
    for (i=1; i<=NF; i++) {
      if ($i == "inet" && (i + 1) <= NF) {
        addr=$(i + 1);
        break;
      }
      if ($i ~ /^addr:/) {
        addr=$i;
        sub(/^addr:/, "", addr);
        break;
      }
      if ($i ~ /^inet addr:/) {
        addr=$i;
        sub(/^inet addr:/, "", addr);
        break;
      }
    }
    sub(/\/.*/, "", addr);
    if (addr != "") print (iface != "" ? iface ": " addr : addr);
  }
' | remote_edit_format_network_addresses)
fi
remote_edit_os_version=''
if [ "$remote_edit_os" = "Linux" ] && [ -r /etc/os-release ]; then
remote_edit_os_version=$(awk -F= '/^PRETTY_NAME=/{ value=$2; gsub(/^"|"$/, "", value); print value; exit }' /etc/os-release 2>/dev/null)
fi
if [ -z "$remote_edit_os_version" ] && [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists oslevel; then
remote_edit_os_version=$(oslevel -s 2>/dev/null || oslevel 2>/dev/null || printf '')
fi
if [ -z "$remote_edit_os_version" ]; then
remote_edit_os_version=$(uname -sr 2>/dev/null || printf '')
fi
remote_edit_uptime=$(uptime 2>/dev/null || printf '')
remote_edit_uptime_seconds=''
if [ -r /proc/uptime ]; then
remote_edit_uptime_seconds=$(awk '{ print int($1) }' /proc/uptime 2>/dev/null)
fi
remote_edit_disk_root=$(df -P / 2>/dev/null | awk 'NR==2 { print $2 "|" $3 "|" $4 "|" $5 }')
remote_edit_memory=''
remote_edit_memory_detail=''
remote_edit_swap=''
remote_edit_swap_detail=''
if remote_edit_cmd_exists free; then
remote_edit_memory=$(free -m 2>/dev/null | awk '/^Mem:/ { print $2 "|" $3 "|" $4 "|free"; exit }')
remote_edit_memory_detail=$(free -m 2>/dev/null | awk '/^Mem:/ { available=$7; buffers_cache=$6; if (available == "") available=$4; if (buffers_cache == "") buffers_cache=""; print $2 "|" $3 "|" $4 "|" available "|" buffers_cache "|free"; exit }')
remote_edit_swap=$(free -m 2>/dev/null | awk '/^Swap:/ { print $2 "|" $3 "|free"; exit }')
remote_edit_swap_detail=$(free -m 2>/dev/null | awk '/^Swap:/ { free=$4; if (free == "") free=$1-$2; print $2 "|" $3 "|" free "|free"; exit }')
elif remote_edit_cmd_exists svmon && remote_edit_cmd_exists pagesize; then
remote_edit_pagesize=$(pagesize 2>/dev/null || printf '0')
remote_edit_memory=$(svmon -G 2>/dev/null | awk -v p="$remote_edit_pagesize" '/^memory/ && p > 0 { printf "%d|%d|%d|svmon", ($2*p)/1048576, ($3*p)/1048576, ($4*p)/1048576; exit }')
remote_edit_memory_detail="$remote_edit_memory"
fi
if [ -z "$remote_edit_swap" ] && [ -r /proc/meminfo ]; then
remote_edit_swap=$(awk '
  /^SwapTotal:/ { total=$2 }
  /^SwapFree:/ { free=$2 }
  END {
    if (total != "") {
      used = total - free;
      if (used < 0) used = 0;
      printf "%d|%d|proc", total / 1024, used / 1024;
    }
  }
' /proc/meminfo 2>/dev/null)
remote_edit_swap_detail=$(awk '
  /^SwapTotal:/ { total=$2 }
  /^SwapFree:/ { free=$2 }
  END {
    if (total != "") {
      used = total - free;
      if (used < 0) used = 0;
      printf "%d|%d|%d|proc", total / 1024, used / 1024, free / 1024;
    }
  }
' /proc/meminfo 2>/dev/null)
fi
if [ -z "$remote_edit_swap" ] && [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists lsps; then
remote_edit_swap=$(lsps -s 2>/dev/null | awk 'NR > 1 { total=$1; pct=$2; gsub(/[^0-9.]/, "", total); gsub(/[^0-9.]/, "", pct); if (total != "") { used=(total*pct)/100; printf "%d|%d|lsps", total, used; exit } }')
remote_edit_swap_detail=$(lsps -s 2>/dev/null | awk 'NR > 1 { total=$1; pct=$2; gsub(/[^0-9.]/, "", total); gsub(/[^0-9.]/, "", pct); if (total != "") { used=(total*pct)/100; free=total-used; if (free < 0) free=0; printf "%d|%d|%d|lsps", total, used, free; exit } }')
fi
remote_edit_sessions=''
if remote_edit_cmd_exists who; then
remote_edit_sessions=$(who 2>/dev/null | awk '
  NF >= 1 { count++; if (!seen[$1]++) order[++unique]=$1 }
  END {
    names="";
    limit=unique < 3 ? unique : 3;
    for (i=1; i<=limit; i++) names = names (names ? ", " : "") order[i];
    if (unique > 3) names = names ", +" (unique - 3);
    if (count != "") print count "|" names;
  }
')
elif remote_edit_cmd_exists users; then
remote_edit_sessions=$(users 2>/dev/null | awk '{ for (i=1; i<=NF; i++) { count++; if (!seen[$i]++) order[++unique]=$i } } END { names=""; limit=unique < 3 ? unique : 3; for (i=1; i<=limit; i++) names = names (names ? ", " : "") order[i]; if (unique > 3) names = names ", +" (unique - 3); if (count != "") print count "|" names; }')
fi
remote_edit_listeners=''
if remote_edit_cmd_exists ss; then
remote_edit_listeners=$(ss -lntu 2>/dev/null | awk 'NR > 1 { proto=tolower($1); if (proto ~ /^tcp/) tcp++; else if (proto ~ /^udp/) udp++; } END { if ((tcp + udp) > 0) print (tcp + udp) "|" tcp "|" udp; }')
fi
if [ -z "$remote_edit_listeners" ] && remote_edit_cmd_exists netstat; then
remote_edit_listeners=$(netstat -an 2>/dev/null | awk '{ proto=tolower($1); state=toupper($0); if (proto ~ /^tcp/ && state ~ /LISTEN/) tcp++; else if (proto ~ /^udp/) udp++; } END { if ((tcp + udp) > 0) print (tcp + udp) "|" tcp "|" udp; }')
fi
remote_edit_io_wait=''
remote_edit_io_wait_detail=''
if remote_edit_cmd_exists vmstat; then
remote_edit_io_wait=$(vmstat 1 2 2>/dev/null | awk '
  {
    for (i=1; i<=NF; i++) {
      if ($i == "wa") wa_col=i;
    }
    if (wa_col > 0 && $1 ~ /^[-0-9.]+$/) value=$wa_col;
  }
  END { if (value != "") print value; }
')
remote_edit_io_wait_detail=$(vmstat 1 2 2>/dev/null | awk '
  {
    for (i=1; i<=NF; i++) {
      if ($i == "us") us_col=i;
      if ($i == "sy") sy_col=i;
      if ($i == "id") id_col=i;
      if ($i == "wa") wa_col=i;
    }
    if (wa_col > 0 && $1 ~ /^[-0-9.]+$/) {
      us = us_col > 0 ? $us_col : "";
      sy = sy_col > 0 ? $sy_col : "";
      idle = id_col > 0 ? $id_col : "";
      wa = $wa_col;
    }
  }
  END { if (wa != "") print wa "|" us "|" sy "|" idle "|vmstat"; }
')
fi
remote_edit_has_systemd='no'
if [ -d /run/systemd/system ] || remote_edit_cmd_exists systemctl; then
remote_edit_has_systemd='yes'
fi
remote_edit_capabilities=''
for remote_edit_capability in systemctl journalctl crontab ps lssrc service svmon free df uptime who users ss netstat vmstat lsps; do
if remote_edit_cmd_exists "$remote_edit_capability"; then
  if [ -n "$remote_edit_capabilities" ]; then
    remote_edit_capabilities="$remote_edit_capabilities,$remote_edit_capability"
  else
    remote_edit_capabilities="$remote_edit_capability"
  fi
fi
done
remote_edit_service_index=0
remote_edit_print_service() {
remote_edit_print "SERVICE_$remote_edit_service_index" "$*"
remote_edit_service_index=$((remote_edit_service_index + 1))
}
remote_edit_process_index=0
remote_edit_print_process() {
remote_edit_print "PROCESS_$remote_edit_process_index" "$*"
remote_edit_process_index=$((remote_edit_process_index + 1))
}
remote_edit_scheduled_index=0
remote_edit_print_scheduled() {
remote_edit_print "SCHEDULED_$remote_edit_scheduled_index" "$*"
remote_edit_scheduled_index=$((remote_edit_scheduled_index + 1))
}
remote_edit_count_user_cron_jobs() {
awk '
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { next }
  $1 ~ /^@[A-Za-z0-9_-]+$/ && NF >= 2 { count++; next }
  NF >= 6 { count++ }
  END { print count + 0 }
'
}
remote_edit_count_system_cron_jobs() {
awk '
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { next }
  $1 ~ /^@[A-Za-z0-9_-]+$/ && NF >= 3 { count++; next }
  NF >= 7 { count++ }
  END { print count + 0 }
'
}
remote_edit_collect_scheduled_jobs() {
remote_edit_print_user_crontab() {
  remote_edit_cron_user="$1"
  remote_edit_cron_output="$2"
  [ -n "$remote_edit_cron_user" ] || return
  [ -n "$remote_edit_cron_output" ] || return
  remote_edit_count=$(printf '%s
' "$remote_edit_cron_output" | remote_edit_count_user_cron_jobs)
  if [ "$remote_edit_count" = "0" ]; then
    remote_edit_label="0 jobs"
  else
    remote_edit_label="$remote_edit_count jobs"
    [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
  fi
  remote_edit_print_scheduled "user|$remote_edit_cron_user|$remote_edit_label|user crontab|$remote_edit_cron_user||$remote_edit_cron_user|yes|no|$remote_edit_cron_user crontab"
}

remote_edit_read_user_crontab() {
  remote_edit_cron_user="$1"
  [ -n "$remote_edit_cron_user" ] || return
  if [ "$remote_edit_cron_user" = "$remote_edit_user" ]; then
    crontab -l 2>/dev/null || true
    return
  fi
  if [ "$remote_edit_os" = "AIX" ]; then
    crontab -l "$remote_edit_cron_user" 2>/dev/null || true
  else
    crontab -u "$remote_edit_cron_user" -l 2>/dev/null || true
  fi
}

remote_edit_is_real_user() {
  remote_edit_check_user="$1"
  [ -n "$remote_edit_check_user" ] || return 1
  case "$remote_edit_check_user" in .*|*/*|*:*|*' '*|*_*) return 1 ;; esac
  if [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists lsuser; then
    lsuser "$remote_edit_check_user" >/dev/null 2>&1 && return 0
  fi
  if remote_edit_cmd_exists getent; then
    getent passwd "$remote_edit_check_user" >/dev/null 2>&1 && return 0
  fi
  if [ -r /etc/passwd ]; then
    awk -F: -v u="$remote_edit_check_user" '$1 == u { found = 1 } END { exit(found ? 0 : 1) }' /etc/passwd 2>/dev/null && return 0
  fi
  [ "$remote_edit_check_user" = "$remote_edit_user" ] && return 0
  return 1
}

remote_edit_find_user_spool_file() {
  remote_edit_spool_user="$1"
  [ -n "$remote_edit_spool_user" ] || return
  for remote_edit_spool_dir in /var/spool/cron /var/spool/cron/crontabs /var/cron/tabs /usr/spool/cron/crontabs; do
    remote_edit_spool_file="$remote_edit_spool_dir/$remote_edit_spool_user"
    [ -f "$remote_edit_spool_file" ] || continue
    printf '%s
' "$remote_edit_spool_file"
    return
  done
}

remote_edit_read_user_crontab_with_fallback() {
  remote_edit_fallback_user="$1"
  remote_edit_fallback_file="$2"
  remote_edit_output=$(remote_edit_read_user_crontab "$remote_edit_fallback_user")
  if [ -n "$remote_edit_output" ]; then
    printf '%s
' "$remote_edit_output"
    return
  fi
  if [ -z "$remote_edit_fallback_file" ]; then
    remote_edit_fallback_file=$(remote_edit_find_user_spool_file "$remote_edit_fallback_user")
  fi
  if [ -n "$remote_edit_fallback_file" ] && [ -r "$remote_edit_fallback_file" ]; then
    cat "$remote_edit_fallback_file" 2>/dev/null || true
  fi
}

if remote_edit_cmd_exists crontab; then
  remote_edit_current_file=$(remote_edit_find_user_spool_file "$remote_edit_user")
  remote_edit_current_cron=$(remote_edit_read_user_crontab_with_fallback "$remote_edit_user" "$remote_edit_current_file")
  remote_edit_print_user_crontab "$remote_edit_user" "$remote_edit_current_cron"

  remote_edit_seen_cron_users=" $remote_edit_user "
  remote_edit_user_scan_count=0
  for remote_edit_spool_dir in /var/spool/cron /var/spool/cron/crontabs /var/cron/tabs /usr/spool/cron/crontabs; do
    [ -d "$remote_edit_spool_dir" ] || continue
    [ -r "$remote_edit_spool_dir" ] || continue
    for remote_edit_cron_user_file in "$remote_edit_spool_dir"/*; do
      [ -f "$remote_edit_cron_user_file" ] || continue
      remote_edit_cron_user=$(basename "$remote_edit_cron_user_file" 2>/dev/null || printf '')
      [ -n "$remote_edit_cron_user" ] || continue
      case "$remote_edit_cron_user" in .*|*.tmp|*.bak|*.old|*~|*_*) continue ;; esac
      case "$remote_edit_seen_cron_users" in *" $remote_edit_cron_user "*) continue ;; esac
      remote_edit_is_real_user "$remote_edit_cron_user" || continue
      remote_edit_seen_cron_users="$remote_edit_seen_cron_users$remote_edit_cron_user "
      remote_edit_user_scan_count=$((remote_edit_user_scan_count + 1))
      [ "$remote_edit_user_scan_count" -gt 50 ] && break
      remote_edit_user_cron=$(remote_edit_read_user_crontab_with_fallback "$remote_edit_cron_user" "$remote_edit_cron_user_file")
      remote_edit_print_user_crontab "$remote_edit_cron_user" "$remote_edit_user_cron"
    done
  done
fi

if [ -r /etc/crontab ]; then
  remote_edit_count=$(remote_edit_count_system_cron_jobs < /etc/crontab 2>/dev/null || printf '0')
  remote_edit_label="$remote_edit_count jobs"
  [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
  remote_edit_print_scheduled "file|/etc/crontab|$remote_edit_label|system crontab|/etc/crontab|/etc/crontab||yes|yes|/etc/crontab"
elif [ -e /etc/crontab ]; then
  remote_edit_print_scheduled "file|/etc/crontab|Permission denied|system crontab|/etc/crontab|/etc/crontab||no|no|/etc/crontab"
fi

if [ -d /etc/cron.d ]; then
  if [ -r /etc/cron.d ]; then
    for remote_edit_cron_file in /etc/cron.d/*; do
      [ -f "$remote_edit_cron_file" ] || continue
      remote_edit_base=$(basename "$remote_edit_cron_file" 2>/dev/null || printf '')
      [ -n "$remote_edit_base" ] || continue
      case "$remote_edit_base" in .*|*.dpkg-*|*.rpm*|*~) continue ;; esac
      if [ -r "$remote_edit_cron_file" ]; then
        remote_edit_count=$(remote_edit_count_system_cron_jobs < "$remote_edit_cron_file" 2>/dev/null || printf '0')
        remote_edit_label="$remote_edit_count jobs"
        [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
        remote_edit_print_scheduled "cron-d|$remote_edit_cron_file|$remote_edit_label|cron.d|$remote_edit_cron_file|$remote_edit_cron_file||yes|yes|$remote_edit_cron_file"
      else
        remote_edit_print_scheduled "cron-d|$remote_edit_cron_file|Permission denied|cron.d|$remote_edit_cron_file|$remote_edit_cron_file||no|no|$remote_edit_cron_file"
      fi
    done
  else
    remote_edit_print_scheduled "cron-d|/etc/cron.d|Permission denied|cron.d|/etc/cron.d|/etc/cron.d||no|no|/etc/cron.d"
  fi
fi

for remote_edit_periodic in hourly daily weekly monthly; do
  remote_edit_dir="/etc/cron.$remote_edit_periodic"
  [ -d "$remote_edit_dir" ] || continue
  if [ ! -r "$remote_edit_dir" ]; then
    remote_edit_print_scheduled "periodic|$remote_edit_dir|Permission denied|$remote_edit_periodic|$remote_edit_dir|$remote_edit_dir||no|no|$remote_edit_dir"
    continue
  fi
  for remote_edit_script in "$remote_edit_dir"/*; do
    [ -f "$remote_edit_script" ] || continue
    remote_edit_base=$(basename "$remote_edit_script" 2>/dev/null || printf '')
    [ -n "$remote_edit_base" ] || continue
    case "$remote_edit_base" in .*|*.dpkg-*|*.rpm*|*~) continue ;; esac
    if [ -r "$remote_edit_script" ]; then
      remote_edit_print_scheduled "periodic|$remote_edit_script|script|$remote_edit_periodic|$remote_edit_script|$remote_edit_script||yes|yes|$remote_edit_script"
    else
      remote_edit_print_scheduled "periodic|$remote_edit_script|Permission denied|$remote_edit_periodic|$remote_edit_script|$remote_edit_script||no|no|$remote_edit_script"
    fi
  done
done
}
remote_edit_collect_processes() {
if ! remote_edit_cmd_exists ps; then
  return
fi
remote_edit_process_adapter=ps
remote_edit_process_output=$(ps -eo pid,user,stat,pcpu,pmem,comm,args 2>/dev/null | awk '
  NR > 1 && $1 ~ /^[0-9]+$/ {
    pid=$1; user=$2; state=$3; cpu=$4; mem=$5; comm=$6; args="";
    for (i=7; i<=NF; i++) { args = args (args ? " " : "") $i; }
    if (args == "") args=comm;
    gsub(/\|/, "/", user); gsub(/\|/, "/", state); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
    print pid "|" user "|" state "|" cpu "|" mem "|" comm "|" args;
  }
')
if [ -z "$remote_edit_process_output" ]; then
  remote_edit_process_output=$(ps -eo pid,user,s,pcpu,pmem,args 2>/dev/null | awk '
    NR > 1 && $1 ~ /^[0-9]+$/ {
      pid=$1; user=$2; state=$3; cpu=$4; mem=$5; args="";
      for (i=6; i<=NF; i++) { args = args (args ? " " : "") $i; }
      comm=args; sub(/[[:space:]].*$/, "", comm);
      gsub(/\|/, "/", user); gsub(/\|/, "/", state); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
      print pid "|" user "|" state "|" cpu "|" mem "|" comm "|" args;
    }
  ')
fi
if [ -z "$remote_edit_process_output" ]; then
  remote_edit_process_output=$(ps -eo pid,user,pcpu,pmem,comm,args 2>/dev/null | awk '
    NR > 1 && $1 ~ /^[0-9]+$/ {
      pid=$1; user=$2; state=""; cpu=$3; mem=$4; comm=$5; args="";
      for (i=6; i<=NF; i++) { args = args (args ? " " : "") $i; }
      if (args == "") args=comm;
      gsub(/\|/, "/", user); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
      print pid "|" user "|" state "|" cpu "|" mem "|" comm "|" args;
    }
  ')
fi
if [ -z "$remote_edit_process_output" ]; then
  remote_edit_process_output=$(ps -eo pid,user,pcpu,pmem,args 2>/dev/null | awk '
    NR > 1 && $1 ~ /^[0-9]+$/ {
      pid=$1; user=$2; state=""; cpu=$3; mem=$4; args="";
      for (i=5; i<=NF; i++) { args = args (args ? " " : "") $i; }
      comm=args; sub(/[[:space:]].*$/, "", comm);
      gsub(/\|/, "/", user); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
      print pid "|" user "|" state "|" cpu "|" mem "|" comm "|" args;
    }
  ')
fi
if [ -z "$remote_edit_process_output" ]; then
  remote_edit_process_output=$(ps -ef 2>/dev/null | awk '
    NR > 1 && $2 ~ /^[0-9]+$/ {
      user=$1; pid=$2; state=""; args="";
      for (i=8; i<=NF; i++) { args = args (args ? " " : "") $i; }
      comm=args; sub(/[[:space:]].*$/, "", comm);
      gsub(/\|/, "/", user); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
      print pid "|" user "|" state "|||" comm "|" args;
    }
  ')
fi
printf '%s
' "$remote_edit_process_output" | while IFS='|' read -r remote_edit_process_pid remote_edit_process_user remote_edit_process_state remote_edit_process_cpu remote_edit_process_memory remote_edit_process_command remote_edit_process_args; do
  [ -n "$remote_edit_process_pid" ] || continue
  remote_edit_print_process "$remote_edit_process_adapter|$remote_edit_process_pid|$remote_edit_process_user|$remote_edit_process_state|$remote_edit_process_cpu|$remote_edit_process_memory|$remote_edit_process_command|$remote_edit_process_args"
done
}
remote_edit_collect_processes
remote_edit_collect_scheduled_jobs
if [ "$remote_edit_os" = "Linux" ]; then
remote_edit_systemd_units=''
if [ "$remote_edit_has_systemd" = "yes" ] && remote_edit_cmd_exists systemctl; then
  remote_edit_systemd_units=$(systemctl list-units --type=service --all --no-legend --no-pager --full 2>/dev/null || systemctl --type=service --all --no-legend --no-pager --full list-units 2>/dev/null || printf '')
  if [ -z "$remote_edit_systemd_units" ]; then
    remote_edit_systemd_units=$(systemctl list-units --type service --all --no-legend --no-pager --full 2>/dev/null || printf '')
  fi
  if [ -z "$remote_edit_systemd_units" ]; then
    remote_edit_systemd_units=$(systemctl list-unit-files --type=service --no-legend --no-pager --full 2>/dev/null | awk 'NF >= 1 && $1 ~ /\.service$/ { print $1 " loaded unknown unknown " $2 }')
  fi
fi

if [ -n "$remote_edit_systemd_units" ]; then
  printf '%s
' "$remote_edit_systemd_units" | awk '
    NF >= 1 {
      if ($1 !~ /\.service$/ && $2 ~ /\.service$/) { unit=$2; active=$4; unit_sub_state=$5; start=6; }
      else { unit=$1; active=$3; unit_sub_state=$4; start=5; }
      if (unit !~ /\.service$/) next;
      if (active == "") active="unknown";
      if (unit_sub_state == "") unit_sub_state="unknown";
      desc="";
      for (i=start; i<=NF; i++) { desc = desc (desc ? " " : "") $i; }
      gsub(/\|/, "/", unit); gsub(/\|/, "/", active); gsub(/\|/, "/", unit_sub_state); gsub(/\|/, "/", desc);
      print unit "|" active " " unit_sub_state "|" desc;
    }
  ' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
    [ -n "$remote_edit_service_name" ] || continue
    remote_edit_print_service "linux-systemd|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
  done
elif remote_edit_cmd_exists service; then
  service --status-all 2>&1 | awk '
    /^ *\[/ {
      marker=$2; name=$4;
      if (name == "") name=$NF;
      status="unknown";
      if (marker == "+") status="running";
      else if (marker == "-") status="stopped";
      if (name != "" && name != "]") print name "|" status "|service --status-all";
      next;
    }
  ' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
    [ -n "$remote_edit_service_name" ] || continue
    remote_edit_print_service "linux-sysv|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
  done
elif [ -d /etc/init.d ]; then
  for remote_edit_init_script in /etc/init.d/*; do
    [ -f "$remote_edit_init_script" ] || continue
    [ -x "$remote_edit_init_script" ] || continue
    remote_edit_service_name=$(basename "$remote_edit_init_script" 2>/dev/null || printf '')
    [ -n "$remote_edit_service_name" ] || continue
    remote_edit_print_service "linux-sysv|$remote_edit_service_name|unknown|$remote_edit_init_script"
  done
fi
elif [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists lssrc; then
lssrc -a 2>/dev/null | awk '
  NR > 1 && $1 != "" {
    subsystem=$1; group=$2; pid=""; status="";
    if ($3 ~ /^[0-9]+$/) { pid=$3; status=$4; } else { status=$3; }
    if (status == "") status="unknown";
    desc=group;
    if (pid != "") desc = desc " pid " pid;
    gsub(/\|/, "/", subsystem); gsub(/\|/, "/", status); gsub(/\|/, "/", desc);
    print subsystem "|" status "|" desc;
  }
' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
  [ -n "$remote_edit_service_name" ] || continue
  remote_edit_print_service "aix-src|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
done
fi
remote_edit_print OS "$remote_edit_os"
remote_edit_print OS_VERSION "$remote_edit_os_version"
remote_edit_print KERNEL "$remote_edit_kernel"
remote_edit_print ARCH "$remote_edit_arch"
remote_edit_print HOSTNAME "$remote_edit_host"
remote_edit_print NETWORK_ADDRESSES "$remote_edit_network_addresses"
remote_edit_print USER "$remote_edit_user"
remote_edit_print ID "$remote_edit_id"
remote_edit_print HOME "$remote_edit_home"
remote_edit_print SHELL "$remote_edit_shell"
remote_edit_print SERVER_TIME "$remote_edit_server_time"
remote_edit_print UPTIME "$remote_edit_uptime"
remote_edit_print UPTIME_SECONDS "$remote_edit_uptime_seconds"
remote_edit_print DISK_ROOT "$remote_edit_disk_root"
remote_edit_print MEMORY "$remote_edit_memory"
remote_edit_print MEMORY_DETAIL "$remote_edit_memory_detail"
remote_edit_print SWAP "$remote_edit_swap"
remote_edit_print SWAP_DETAIL "$remote_edit_swap_detail"
remote_edit_print SESSIONS "$remote_edit_sessions"
remote_edit_print LISTENERS "$remote_edit_listeners"
remote_edit_print IO_WAIT "$remote_edit_io_wait"
remote_edit_print IO_WAIT_DETAIL "$remote_edit_io_wait_detail"
remote_edit_disk_detail_index=0
(df -P -k 2>/dev/null || df -k 2>/dev/null) | awk 'NR > 1 && $2 ~ /^[0-9]+$/ { fs=$1; total=$2; used=$3; avail=$4; pct=$5; mount=$6; for (i=7; i<=NF; i++) mount=mount " " $i; gsub(/\|/, "/", fs); gsub(/\|/, "/", mount); print fs "|" mount "|" total "|" used "|" avail "|" pct; }' | while IFS='|' read -r remote_edit_disk_fs remote_edit_disk_mount remote_edit_disk_total remote_edit_disk_used remote_edit_disk_free remote_edit_disk_pct; do
[ -n "$remote_edit_disk_fs" ] || continue
remote_edit_print "DISK_FS_$remote_edit_disk_detail_index" "$remote_edit_disk_fs|$remote_edit_disk_mount|$remote_edit_disk_total|$remote_edit_disk_used|$remote_edit_disk_free|$remote_edit_disk_pct"
remote_edit_disk_detail_index=$((remote_edit_disk_detail_index + 1))
done
if remote_edit_cmd_exists who; then
remote_edit_session_detail_index=0
who 2>/dev/null | awk 'NF >= 1 { user=$1; tty=$2; login=""; from=""; if (NF >= 4) login=$3 " " $4; if (NF >= 5) { from=$5; gsub(/[()]/, "", from); } gsub(/\|/, "/", user); gsub(/\|/, "/", tty); gsub(/\|/, "/", from); gsub(/\|/, "/", login); print user "|" tty "|" from "|" login; }' | while IFS='|' read -r remote_edit_session_user remote_edit_session_tty remote_edit_session_from remote_edit_session_login; do
  [ -n "$remote_edit_session_user" ] || continue
  remote_edit_print "SESSION_DETAIL_$remote_edit_session_detail_index" "$remote_edit_session_user|$remote_edit_session_tty|$remote_edit_session_from|$remote_edit_session_login"
  remote_edit_session_detail_index=$((remote_edit_session_detail_index + 1))
done
fi
if remote_edit_cmd_exists ss; then
remote_edit_listener_detail_index=0
ss -lntu 2>/dev/null | awk 'NR > 1 { proto=tolower($1); state=toupper($2); local=$5; if (local == "") next; port=local; sub(/^.*:/, "", port); address=local; sub(/:[^:]*$/, "", address); gsub(/^\[/, "", address); gsub(/\]$/, "", address); gsub(/\|/, "/", proto); gsub(/\|/, "/", address); gsub(/\|/, "/", port); gsub(/\|/, "/", state); if (proto ~ /^(tcp|udp)/) print proto "|" address "|" port "|" state; }' | while IFS='|' read -r remote_edit_listener_proto remote_edit_listener_addr remote_edit_listener_port remote_edit_listener_state; do
  [ -n "$remote_edit_listener_proto" ] || continue
  remote_edit_print "LISTENER_DETAIL_$remote_edit_listener_detail_index" "$remote_edit_listener_proto|$remote_edit_listener_addr|$remote_edit_listener_port|$remote_edit_listener_state"
  remote_edit_listener_detail_index=$((remote_edit_listener_detail_index + 1))
done
elif remote_edit_cmd_exists netstat; then
remote_edit_listener_detail_index=0
netstat -an 2>/dev/null | awk '{ proto=tolower($1); if (proto !~ /^(tcp|udp)/) next; state=toupper($NF); local=$4; if (local == "") next; if (proto ~ /^tcp/ && state !~ /LISTEN/) next; port=local; sub(/^.*[.:]/, "", port); address=local; sub(/[.:][^.:]*$/, "", address); gsub(/\|/, "/", proto); gsub(/\|/, "/", address); gsub(/\|/, "/", port); gsub(/\|/, "/", state); print proto "|" address "|" port "|" state; }' | while IFS='|' read -r remote_edit_listener_proto remote_edit_listener_addr remote_edit_listener_port remote_edit_listener_state; do
  [ -n "$remote_edit_listener_proto" ] || continue
  remote_edit_print "LISTENER_DETAIL_$remote_edit_listener_detail_index" "$remote_edit_listener_proto|$remote_edit_listener_addr|$remote_edit_listener_port|$remote_edit_listener_state"
  remote_edit_listener_detail_index=$((remote_edit_listener_detail_index + 1))
done
fi
remote_edit_print HAS_SYSTEMD "$remote_edit_has_systemd"
remote_edit_print CAPABILITIES "$remote_edit_capabilities"
exit 0`;
}
