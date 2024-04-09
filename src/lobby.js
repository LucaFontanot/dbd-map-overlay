var CronJob = require('cron').CronJob;
var job = new CronJob(
    '*/15 * * * * *',
    function() {
        fetchUpdate()
    }, null, true, 'America/Los_Angeles'
);
const lobbyData = {
    joined: false,
    id:0,
    code: 0,
    creator: false,
    map: "",
    map_base64:"",
    map_base64_hash:"",
    last_map_user:""
}
async function createLobby() {
    $('#overlay').slideDown();
    $("#loadingContent").text("Performing a quick security check")
    try {
        let body = JSON.stringify({
            user: settings.token
        })
        let lobby = await axios.post(baseUrl + "/api/createLobby", body, {
            headers:{
                "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"],[body]),
                "content-type":"application/json"
            }
        })
        if (lobby.data.ok) {
            lobbyData.id = lobby.data.id;
            lobbyData.code = lobby.data.code
            lobbyData.joined = true;
            lobbyData.creator = true;
            $("#joinOrCreate").slideUp();
            $("#joinedLobby").slideDown();
            $("#codeJoined").val(lobbyData.code)
            job.start()
            fetchUpdate()
            sendMap(lastMap,lastMapType)
        }
    } catch (e) {

    }
    $('#overlay').slideUp();
}
function toggleHide(){
    let attr = $("#codeJoined").attr("type")
    if (attr==="password"){
        $("#codeJoined").attr("type","text")
    }else{
        $("#codeJoined").attr("type","password")
    }
}
async function joinLobby() {
    $('#overlay').slideDown();
    $("#loadingContent").text("Performing a quick security check")
    try {
        let body = JSON.stringify({
            user: settings.token,
            code: parseInt($("#codeJoin").val())
        })
        let lobby = await axios.post(baseUrl + "/api/joinRoom", body,{
            headers:{
                "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"],[body]),
                "content-type":"application/json"
            }
        })
        if (lobby.data.ok) {
            lobbyData.id = lobby.data.id;
            lobbyData.code = lobby.data.code
            lobbyData.joined = true;
            lobbyData.creator = false;
            $("#joinOrCreate").slideUp();
            $("#joinedLobby").slideDown();
            $("#closeLobby").css({
                display:"none"
            })
            $("#codeJoined").val(lobbyData.code)
            job.start()
            fetchUpdate()
        }
    } catch (e) {

    }
    $('#overlay').slideUp();
}
async function closeLobby(status) {
    if (!lobbyData.joined || !lobbyData.creator) return;
    $('#overlay').slideDown();
    try {
        let lobby = await axios.post(baseUrl + "/api/setCloseStatus", {
            user: settings.token,
            id: lobbyData.id,
            status
        })
        if (lobby.data.ok) {
            if (status){
                $("#closeLobby").css({
                    display: "block"
                })
                $("#openLobby").css({
                    display: "none"
                })
            }else{
                $("#closeLobby").css({
                    display: "none"
                })
                $("#openLobby").css({
                    display: "block"
                })
            }
        }
    } catch (e) {

    }
    $('#overlay').slideUp();
}
async function leaveLobby() {
    if (!lobbyData.joined) return;
    $('#overlay').slideDown();
    try {
        let lobby = await axios.post(baseUrl + "/api/leaveRoom", {
            user: settings.token,
            id: lobbyData.id,
        })
        if (lobby.data.ok) {
            lobbyData.id = "";
            lobbyData.code = ""
            lobbyData.joined = false;
            lobbyData.creator = false;
            lobbyData.map = "";
            $("#joinOrCreate").slideDown();
            $("#joinedLobby").slideUp();
            $("#closeLobby").css({
                display:"block"
            })
            $("#codeJoined").val("")
            job.stop()

        }
    } catch (e) {

    }
    $('#overlay').slideUp();
}
async function setApiMap(map,type) {
    if (!lobbyData.joined) return;
    try {
        let lobby = await axios.post(baseUrl + "/api/setMap", {
            user: settings.token,
            id: lobbyData.id,
            map,
            type
        })
        if (lobby.data.ok) {

        }
    } catch (e) {

    }
}
async function fetchUpdate(){
    if (!lobbyData.joined) return;
    try {
        let lobby = await axios.post(baseUrl + "/api/getLobbyData", {
            user: settings.token,
            id: lobbyData.id,
        })
        if (lobby.data.ok) {
            if (lobby.data.type === "standard"){
                if (lobbyData.map !== lobby.data.map){
                    lobbyData.map = lobby.data.map;
                    lobbyData.map_base64_hash = "";
                    lobbyData.map_base64 = "";
                    sendMap(lobby.data.map,"standars", false)
                }
            }else if (lobby.data.type === "custom"){
                if (lobbyData.id !==lobby.data.last_changer){
                    if (lobbyData.map_base64_hash !== lobby.data.map64hash){
                        let lobbyimage = await axios.post(baseUrl + "/api/getLobbyCustomImage", {
                            user: settings.token,
                            id: lobbyData.id,
                        })
                        if (lobbyimage.data.ok){
                            lobbyData.map_base64 = lobbyimage.data.map;
                            lobbyData.map_base64_hash = lobby.data.map64hash;
                            lobbyData.map = "";
                            sendMap(lobbyData.map_base64,"base64",false)
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(e)
    }
}

