# DNS Benchmark

A free little tool from [thingamalabs](https://github.com/thingamalabs). Find it useful? [☕ Buy me a coffee](https://ko-fi.com/thingamalabs)

Find the fastest DNS resolver from **your** network. Tests plain DNS (IPv4/IPv6),
DNS-over-TLS (DoT) and DNS-over-HTTPS (DoH) side by side, including the resolvers
your computer currently uses.

## Download & run

Get the zip for your computer from the [Releases page](../../releases/latest), unzip it, then:

### Mac
1. Double-click `dnsbench`. macOS will say it "cannot be opened" because the app isn't from the App Store — click **Done**.
2. Open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to "dnsbench".
3. Double-click `dnsbench` again and confirm **Open**. (Only needed the first time.)

Use `mac-apple-silicon` for M1/M2/M3/M4 Macs, `mac-intel` for older ones.

### Windows
1. Double-click `dnsbench.exe`.
2. If "Windows protected your PC" appears, click **More info → Run anyway**.

### Then
Your browser opens the benchmark page. Click **Run**. A terminal window stays open while it runs — close it to quit.

## Reading the results
- **Lower is faster** (milliseconds). Ranking uses the median of all queries.
- 📌 rows are the resolvers your computer uses right now.
- **Green** names validate DNSSEC.
- **IPv4/IPv6** = classic, unencrypted DNS. **DoT/DoH** = encrypted DNS (private from your ISP).

## For developers
```
node server.js             # run from source (Node 22+; building needs Node 26)
node server.js --selftest  # one query per protocol
git tag v1.0.0 && git push --tags   # builds Mac/Windows/Linux releases via GitHub Actions
```

## License
MIT © 2026 thingamalabs — free to use, share and modify. If it saved you time, [a coffee](https://ko-fi.com/thingamalabs) is always appreciated.
