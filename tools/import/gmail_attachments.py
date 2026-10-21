#!/usr/bin/env python3
"""Save Golf League spreadsheet attachments from Gmail into a folder.

Two sources:

  imap  Download directly from Gmail using an app password (fastest):
          python3 -I tools/import/gmail_attachments.py imap you@gmail.com ../leaguemates-data/history
        The app password is read from TEEMATE_GMAIL_APP_PASSWORD or prompted for.
        Mailbox access is read-only.

  mbox  Extract from a Google Takeout .mbox export:
          python3 -I tools/import/gmail_attachments.py mbox "Golf League.mbox" ../leaguemates-data/history

Identical attachments (same bytes) are saved once. Files are named
<email date>_<short hash>_<original name>, and manifest.csv lists every file saved.
Re-running skips files already in the folder. Standard library only.
"""

import argparse
import csv
import email
import email.policy
import email.utils
import getpass
import hashlib
import imaplib
import mailbox
import os
import re
import sys
from pathlib import Path

DEFAULT_LABEL = "Golf League"
DEFAULT_EXTENSIONS = ("xlsx", "xlsm", "xls", "csv", "ods", "pdf")
HASH_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_([0-9a-f]{12})_")
IMAP_BATCH = 25


def parse_message(f):
    return email.message_from_binary_file(f, policy=email.policy.default)


def message_date(msg):
    try:
        return email.utils.parsedate_to_datetime(msg["Date"]).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return "0000-00-00"


def has_label(msg, label):
    labels = str(msg.get("X-Gmail-Labels", ""))
    return label.lower() in (part.strip().strip('"').lower() for part in labels.split(","))


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip() or "attachment"


class AttachmentSink:
    """Writes unique attachments to out_dir and records them in manifest.csv."""

    def __init__(self, out_dir, extensions):
        self.out_dir = out_dir
        self.exts = {e.lower().lstrip(".") for e in extensions}
        out_dir.mkdir(parents=True, exist_ok=True)
        self.seen = {m.group(1) for p in out_dir.iterdir() if (m := HASH_RE.match(p.name))}
        manifest_path = out_dir / "manifest.csv"
        new_manifest = not manifest_path.exists()
        self._manifest = manifest_path.open("a", newline="", encoding="utf-8")
        self._writer = csv.writer(self._manifest)
        if new_manifest:
            self._writer.writerow(["file", "email_date", "subject", "from", "original_name", "hash"])
        self.messages = self.saved = self.duplicates = 0

    def add_message(self, msg):
        self.messages += 1
        for part in msg.walk():
            name = part.get_filename()
            if not name or name.rsplit(".", 1)[-1].lower() not in self.exts:
                continue
            data = part.get_payload(decode=True)
            if not data:
                continue
            digest = hashlib.sha256(data).hexdigest()[:12]
            if digest in self.seen:
                self.duplicates += 1
                continue
            date = message_date(msg)
            file_name = f"{date}_{digest}_{safe_name(name)}"
            (self.out_dir / file_name).write_bytes(data)
            self.seen.add(digest)
            self.saved += 1
            self._writer.writerow([file_name, date, str(msg["Subject"] or ""), str(msg["From"] or ""), name, digest])

    def close(self):
        self._manifest.close()
        print(f"Scanned {self.messages} message(s); saved {self.saved} new file(s), "
              f"skipped {self.duplicates} duplicate(s).")
        print(f"Output: {self.out_dir}")


def from_mbox(args, sink):
    for msg in mailbox.mbox(args.mbox, factory=parse_message, create=False):
        if msg is None or (args.label and not has_label(msg, args.label)):
            continue
        sink.add_message(msg)


def from_imap(args, sink):
    password = os.environ.get("TEEMATE_GMAIL_APP_PASSWORD") or getpass.getpass("Gmail app password: ")
    password = password.replace(" ", "")  # Google displays app passwords in groups of four

    with imaplib.IMAP4_SSL("imap.gmail.com") as imap:
        imap.login(args.user, password)
        mailbox_name = '"' + args.label.replace("\\", "\\\\").replace('"', '\\"') + '"'
        status, _ = imap.select(mailbox_name, readonly=True)
        if status != "OK":
            sys.exit(f"Gmail label not found: {args.label}")

        status, data = imap.uid("SEARCH", None, "X-GM-RAW", '"has:attachment"')
        if status != "OK":
            sys.exit("Gmail search failed")
        uids = data[0].split()
        print(f"{len(uids)} message(s) with attachments under '{args.label}'")

        for i in range(0, len(uids), IMAP_BATCH):
            batch = b",".join(uids[i:i + IMAP_BATCH])
            status, data = imap.uid("FETCH", batch, "(BODY.PEEK[])")
            if status != "OK":
                sys.exit(f"Fetch failed for messages {i + 1}-{i + IMAP_BATCH}")
            for item in data:
                if isinstance(item, tuple):
                    sink.add_message(email.message_from_bytes(item[1], policy=email.policy.default))
            print(f"  {min(i + IMAP_BATCH, len(uids))}/{len(uids)} fetched")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="source", required=True)

    p_imap = sub.add_parser("imap", help="download from Gmail with an app password")
    p_imap.add_argument("user", help="Gmail address")
    p_imap.add_argument("out_dir", type=Path)
    p_imap.add_argument("--label", default=DEFAULT_LABEL, help=f"Gmail label (default: {DEFAULT_LABEL})")

    p_mbox = sub.add_parser("mbox", help="extract from a Google Takeout .mbox file")
    p_mbox.add_argument("mbox", type=Path)
    p_mbox.add_argument("out_dir", type=Path)
    p_mbox.add_argument("--label", help="only messages with this Gmail label (needed if the export has more than one label)")

    for p in (p_imap, p_mbox):
        p.add_argument("--ext", nargs="+", default=DEFAULT_EXTENSIONS, help="file extensions to keep")

    args = ap.parse_args()
    sink = AttachmentSink(args.out_dir, args.ext)
    try:
        (from_imap if args.source == "imap" else from_mbox)(args, sink)
    finally:
        sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
