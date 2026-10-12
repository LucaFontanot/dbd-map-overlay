(function (){
    window.lsChallange = {
        async sha256(data){
            const msgBuffer = new TextEncoder().encode(data);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },
        // Server-controlled difficulty: bound the work so a bad/hostile
        // challenge can't spin the renderer forever.
        MAX_DIFFICULTY: 6,
        MAX_ITERATIONS: 5e7,
        async computeNonce(conf){
            var nonce = conf.nonce ? String(conf.nonce) : "0"
            var data = conf.data ? conf.data : ""
            var difficulty = parseInt(conf.difficulty, 10)
            if (!Number.isFinite(difficulty) || difficulty < 1) difficulty = 4
            // A prefix longer/shorter than the difficulty can never match
            if (difficulty > this.MAX_DIFFICULTY || nonce.length !== difficulty) {
                return null
            }
            var hash
            for (var answer = 0; answer < this.MAX_ITERATIONS; answer++) {
                hash = await this.sha256(data + answer);
                if (hash.substring(0, difficulty) === nonce) {
                    return [answer,hash]
                }
            }
            return null
        },
        async getVerificationPayload(nonce) {
            return new Promise(function (resolve) {
                var xhttp = new XMLHttpRequest();
                xhttp.onreadystatechange = function () {
                    if (this.readyState == 4 && this.status == 200) {
                        resolve(JSON.parse(xhttp.responseText))
                    } else if (this.readyState == 4 && this.status !== 200) {
                        resolve(false)
                    }
                };
                xhttp.open("GET", "https://dbdmap.lucaservers.com/api/challange?data=" + encodeURIComponent(nonce), true);
                xhttp.send();
            })
        },
        async getVerificationHeader(fields, data){
            var digest = await this.sha256(data.join(","))
            var headerBuild = "target=\"" + fields.join(",") + "\" digest=\"SHA256" + digest + "\" ";
            var payload = await this.getVerificationPayload(digest)
            if (payload && typeof payload === "object"){
                var solved = await this.computeNonce(payload)
                if (solved === null) {
                    return "-1"
                }
                headerBuild+="token=\"" + payload.token + "\" "
                headerBuild+="answer=\"" + solved[0] + "\""
                return headerBuild
            }
            return "-1"
        }
    }
})();