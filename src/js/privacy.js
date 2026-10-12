const axios = require("axios");
const marked = require("marked");
const createDOMPurify = require("dompurify");
const {debugLog} = require("./logger");
const {GITHUB_ASSETS, GITHUB_REPO} = require("./consts");

// Remote markdown is rendered in a nodeIntegration window: anything that
// reaches .html() unsanitized can run Node code. Always go through renderMarkdown.
const DOMPurify = createDOMPurify(window);
DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    // Links open externally (main's window-open handler routes them to
    // openExternal) and never navigate the app window itself.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

function renderMarkdown(markdown) {
    return DOMPurify.sanitize(marked.parse(String(markdown || "")));
}

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
            $("#modalPrivacyContent").html(renderMarkdown(privacy.data))
        } catch (e) {
            debugLog("privacy::setPrivacy::error", e.message);
            $("#modalPrivacyContent").html("<p>Error loading privacy policy</p>")
        }
    }

    async setFaq() {
        debugLog("privacy::setFaq::called");
        try {
            let faq = await axios.get(this.baseUrl + "/FAQ.md")
            $("#faqModalContent").html(renderMarkdown(faq.data))
        } catch (e) {
            debugLog("privacy::setFaq::error", e.message);
            $("#faqModalContent").html("<p>Error loading FAQ</p>")
        }
    }

    async setChangelog() {
        debugLog("privacy::setChangelog::called");
        try {
            let changelog = await axios.get(this.baseUrl + "/CHANGELOG.md")
            $("#changelogsContent").html(renderMarkdown(changelog.data))
        } catch (e) {
            debugLog("privacy::setChangelog::error", e.message);
            $("#changelogsContent").html("<p>Error loading changelog</p>")
        }
    }

    async setCredits() {
        debugLog("privacy::setCredits::called");
        try {
            let credits = await axios.get(this.baseUrl + "/CREDITS.md")
            $("#creditsContent").html(renderMarkdown(credits.data))
        } catch (e) {
            debugLog("privacy::setCredits::error", e.message);
            $("#creditsContent").html("<p>Error loading credits</p>")
        }
    }
}

module.exports = Privacy;
