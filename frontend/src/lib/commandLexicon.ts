// How Linux commands and system names are said aloud (SPEC-018, RF-13). The
// synthetic voice does not know they are commands: it reads "ls" as a word and
// "chmod" as nonsense. Short names are spelled with spaced capitals ("L S"), which
// the voice reads letter by letter, and the others are respelled the way they
// sound in Portuguese. Only the text inside code elements and the commands of the
// steps go through this table, never the prose of the lessons.

/** Names read letter by letter. */
const SPELLED = [
  "ls", "cd", "pwd", "rm", "mv", "cp", "ln", "df", "du", "ps", "wc", "id", "su", "dd", "sh", "zsh", "ssh", "scp", "sshd", "apt", "dpkg", "rpm", "deb",
  "dnf", "tmp", "mnt", "txt", "etc", "env", "gz", "tgz", "pid", "uid", "gid", "ip", "dns", "tty", "lsblk", "lsof", "rwx", "ufw", "sbin", "fstab",
  "sysctl", "uuid",
] as const;

/** Names respelled as they sound. */
const RESPELLED: Record<string, string> = {
  sudo: "sudô",
  chmod: "chê mod",
  chown: "chê ôn",
  chgrp: "chê grupo",
  mkdir: "make dir",
  rmdir: "R M dir",
  cat: "cát",
  grep: "grép",
  sed: "sêd",
  awk: "ók",
  tail: "têil",
  head: "héd",
  echo: "écô",
  whoami: "who am I",
  uname: "iú name",
  hostname: "host name",
  useradd: "user add",
  usermod: "user mod",
  userdel: "user del",
  adduser: "add user",
  groupadd: "group add",
  passwd: "password",
  gpasswd: "G password",
  visudo: "vi sudô",
  sudoers: "sudô érs",
  nginx: "engine X",
  www: "W W W",
  wheel: "uíl",
  root: "rút",
  usr: "user",
  var: "vár",
  opt: "ópt",
  dev: "dév",
  proc: "próc",
  git: "guit",
  curl: "cârl",
  htop: "H top",
  tree: "tri",
  touch: "tátch",
  stat: "stát",
  umask: "u mask",
  kill: "quil",
  killall: "quil ól",
  man: "mén",
  less: "léss",
  more: "mór",
  tar: "tár",
  nano: "nâno",
  find: "fáind",
  xargs: "X args",
  tee: "ti",
  which: "uítch",
  neofetch: "nio fétch",
  wget: "W get",
  ifconfig: "I F config",
  cron: "crôn",
  crontab: "cron tab",
  mount: "máunt",
  umount: "u máunt",
  cowsay: "cau sei",
  systemctl: "system C T L",
  journalctl: "journal C T L",
  lsb_release: "L S B release",
  sshd_config: "S S H D config",
  bashrc: "bash R C",
};

/** Hyphenated names said as one name, instead of "word traço word". */
export const COMPOUNDS: Record<string, string> = {
  "apt-get": "A P T get",
  "apt-cache": "A P T cache",
  "os-release": "O S release",
  "www-data": "W W W data",
  "ssh-keygen": "S S H keygen",
  "nginx-common": "engine X common",
};

/** The table: name in lower case to what is said. */
export const LEXICON: Record<string, string> = {
  ...Object.fromEntries(SPELLED.map((name) => [name, name.toUpperCase().split("").join(" ")])),
  ...RESPELLED,
};
