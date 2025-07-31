(function (){
    window.lsChallange = {
        async sha256(data){
            const msgBuffer = new TextEncoder().encode(data);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },
        async computeNonce(conf){
            var nonce = conf.nonce ? conf.nonce : "0"
            var data = conf.data ? conf.data : ""
            var difficulty = conf.difficulty ? conf.difficulty : 4
            var answer = 0;
            var hash
            while (true) {
                hash = await this.sha256(data + answer);
                if (hash.substring(0, difficulty) === nonce) {
                    return [answer,hash]
                    break;
                }
                answer++;
            }
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
            if (payload!==false){
                headerBuild+="token=\"" + payload.token + "\" "
                let [answer,hash] = await this.computeNonce(payload)
                headerBuild+="answer=\"" + answer + "\""
                return headerBuild
            }
            return "-1"
        }
    }
})();