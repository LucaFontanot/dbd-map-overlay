const axios = require("axios");
const marked = require("marked");
const {debugLog} = require("./logger");
const {GITHUB_ASSETS, GITHUB_REPO} = require("./consts");

class Privacy {
    constructor() {
        this.baseUrl = GITHUB_ASSETS + "/" + GITHUB_REPO
        this.setPrivacy()
        this.setFaq()
        this.setChangelog()
        this.setCredits()
    }

    async setPrivacy() {
        debugLog("privacy::setPrivacy::called");
        try {
            let privacy = await axios.get(this.baseUrl + "/TERMS%20AND%20PRIVACY.md")
            $("#modalPrivacyContent").html(marked.parse(privacy.data))
        } catch (e) {
            debugLog("privacy::setPrivacy::error", e.message);
            $("#modalPrivacyContent").html("<p>Error loading privacy policy</p>")
        }
    }

    async setFaq() {
        debugLog("privacy::setFaq::called");
        try {
            let faq = await axios.get(this.baseUrl + "/FAQ.md")
            $("#faqModalContent").html(marked.parse(faq.data))
        } catch (e) {
            debugLog("privacy::setFaq::error", e.message);
            $("#faqModalContent").html("<p>Error loading FAQ</p>")
        }
    }

    async setChangelog() {
        debugLog("privacy::setChangelog::called");
        try {
            let changelog = await axios.get(this.baseUrl + "/CHANGELOG.md")
            $("#changelogsContent").html(marked.parse(changelog.data))
        } catch (e) {
            debugLog("privacy::setChangelog::error", e.message);
            $("#changelogsContent").html("<p>Error loading changelog</p>")
        }
    }

    async setCredits() {
        debugLog("privacy::setCredits::called");
        try {
            let credits = await axios.get(this.baseUrl + "/CREDITS.md")
            $("#creditsContent").html(marked.parse(credits.data))
        } catch (e) {
            debugLog("privacy::setCredits::error", e.message);
            $("#creditsContent").html("<p>Error loading credits</p>")
        }
    }
}

module.exports = Privacy