const translations = {
    en: { title: "SwiftPDF", upload: "Upload PDF Files", process: "Process Now" },
    hi: { title: "SwiftPDF", upload: "पीडीएफ फाइलें अपलोड करें", process: "अभी प्रोसेस करें" },
    mr: { title: "SwiftPDF", upload: "पीडीएफ फाइल्स अपलोड करा", process: "आता प्रोसेस करा" }
};

window.changeLanguage = (lang) => {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        el.innerText = translations[lang][key];
    });
};