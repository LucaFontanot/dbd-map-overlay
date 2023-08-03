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
    map: ""
}
async function createLobby() {
    $('#overlay').slideDown();
    try {
        let lobby = await axios.post(baseUrl + "/api/createLobby", {
            user: settings.id
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
            setApiMap(lastMap)
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
    try {
        let lobby = await axios.post(baseUrl + "/api/joinRoom", {
            user: settings.id,
            code: parseInt($("#codeJoin").val())
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
            user: settings.id,
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
            user: settings.id,
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
async function setApiMap(map) {
    if (!lobbyData.joined) return;
    try {
        let lobby = await axios.post(baseUrl + "/api/setMap", {
            user: settings.id,
            id: lobbyData.id,
            map
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
            user: settings.id,
            id: lobbyData.id,
        })
        if (lobby.data.ok) {
            if (lobbyData.map !== lobby.data.map){
                lobbyData.map = lobby.data.map;
                sendMap(lobby.data.map,false)
            }
        }
    } catch (e) {
        console.log(e)
    }
}

