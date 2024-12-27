const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const app = express();

// Utiliser CORS
app.use(cors());

// Fonction pour ajouter un délai
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fonction pour normaliser les dates
const normalizeDate = (dateStr) => {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const frenchMonths = [
        'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
        'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
    ];

    // Remplacer les mois abrégés par les mois complets
    shortMonths.forEach((shortMonth, index) => {
        dateStr = dateStr.replace(new RegExp(shortMonth, 'i'), months[index]);
    });

    // Remplacer les mois français par les mois complets
    frenchMonths.forEach((frenchMonth, index) => {
        dateStr = dateStr.replace(new RegExp(frenchMonth, 'i'), months[index]);
    });

    // Convertir la date en objet Date
    let date;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        // Format "DD/MM/YYYY"
        const [day, month, year] = dateStr.split('/');
        date = new Date(`${year}-${month}-${day}`);
    } else if (/^\d{2} \w+ \d{4}$/.test(dateStr)) {
        // Format "DD Month YYYY"
        date = new Date(dateStr);
    } else {
        date = new Date(dateStr);
    }

    // Vérifier si la date est valide
    if (isNaN(date.getTime())) {
        console.error('Date invalide :', dateStr);
        return null;
    }

    // Formater la date en YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
};

// Fonction pour convertir une date au format "29 Nov" en une date complète
const convertToFullDate = (dateStr) => {
    const months = {
        Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };

    const [day, month] = dateStr.split(' ');
    const year = new Date().getFullYear(); // Utiliser l'année courante

    const fullDate = `${year}-${months[month]}-${day.padStart(2, '0')}`;
    return fullDate;
};

// Fonction pour scraper les articles de La Gazette des Comores
const scrapeLagazette = async (url) => {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
            }
        });
        const $ = cheerio.load(data);

        const articles = await Promise.all(
            $('.actu-mini')
                .map(async (i, el) => {
                    const image = $(el).find('.actu-mini-img a img').attr('src');
                    const lien_article = $(el).find('.actu-mini-caption a').attr('href');
                    const title = $(el).find('.actu-mini-caption h5').text();
                    const date = $(el).find('.actu-mini-footer div > ul > li:nth-child(1)').text();
                    const categorie = $(el).find('.actu-mini-footer div > ul > li:nth-child(3) a').text();

                    if (!image || !lien_article || !title) return null;

                    const article = {
                        id: uuidv4(),
                        image: 'https://lagazettedescomores.com/' + image,
                        title: title.trim(),
                        detail_link: 'https://lagazettedescomores.com/' + lien_article,
                        date: convertToFullDate(date.trim()),
                        categorie: categorie.trim(),
                    };

                    // Récupérer le contenu de l'article détaillé
                    const { data: detailHtml } = await axios.get(article.detail_link, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                        }
                    });
                    const $detail = cheerio.load(detailHtml);

                    const article_summary = $detail('.article-in div:nth-child(3) .article-content p')
                        .not(':last')
                        .text();

                    article['body'] = article_summary.trim();
                    return article;
                })
                .get()
        );

        return articles.filter(Boolean);
    } catch (error) {
        console.error('Erreur lors du scraping de La Gazette des Comores :', error.message);
        return [];
    }
};

// Fonction pour scraper les articles de Comores Infos avec gestion des erreurs et réessais
const scrapeComoresInfos = async (url) => {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                }
            });
            const $ = cheerio.load(data);

            const articles = await Promise.all(
                $('article')
                    .map(async (i, el) => {
                        const detail_link = $(el).find('div:nth-child(1) a').attr('href');
                        const title = $(el).find('div:nth-child(1) a').attr('title');

                        if (!detail_link || !title) return null;

                        let detailUrl;
                        let attempts = 0;
                        while (attempts < 3) {
                            try {
                                const { data: detailHtml } = await axios.get(detail_link, {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                                    }
                                });
                                detailUrl = detailHtml;
                                break;
                            } catch (error) {
                                if (error.response && error.response.status === 503) {
                                    console.error(`Erreur 503 lors du scraping de l'article ${title}. Réessai ${attempts + 1}/3`);
                                    attempts++;
                                    await delay(2000); // Attendre 2 secondes avant de réessayer
                                } else {
                                    console.error(`Erreur lors du scraping de l'article ${title} :`, error.message);
                                    return null;
                                }
                            }
                        }

                        if (!detailUrl) return null;

                        const $detail = cheerio.load(detailUrl);

                        const image = $detail('.entry-content a > img').attr('src');
                        const body = $detail('.entry-content p').text();
                        const categorie = $detail('.entry-header p span.entry-meta-categories a:nth-child(2)').text();
                        const date = $detail('.entry-header p span.entry-meta-date a').text();

                        const article = {
                            id: uuidv4(),
                            image: image ? image.trim() : null,
                            title: title.trim(),
                            date: normalizeDate(date.trim()),
                            body: body.trim(),
                            categorie: categorie.trim(),
                            detail_link: detail_link.trim(),
                        };
                        return article;
                    })
                    .get()
            );

            return articles.filter(Boolean);
        } catch (error) {
            if (error.response && error.response.status === 503) {
                console.error(`Erreur 503 lors du scraping de Comores Infos. Réessai ${retries + 1}/${maxRetries}`);
                retries++;
                await delay(2000); // Attendre 2 secondes avant de réessayer
            } else {
                console.error('Erreur lors du scraping de Comores Infos :', error.message);
                return [];
            }
        }
    }
    return [];
};

// Fonction pour scraper les articles de Al Watan
const scrapeAlWatan = async (url) => {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
            }
        });
        const $ = cheerio.load(data);

        const articles = await Promise.all(
            $('article')
                .map(async (i, el) => {
                    const detail_link = url + $(el).find('a').attr('href');
                    // console.log(`detail_link: ${detail_link}`);

                    if (!detail_link) return null;

                    const { data: detailHtml } = await axios.get(detail_link, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                        }
                    });
                    const $detail = cheerio.load(detailHtml);

                    const title = $detail('article h2.titre-article').text();
                    const body = $detail('article div.text-content p').text();
                    const categorie = $detail('article .line-date span:nth-child(1)').text();
                    const date = $detail('article .line-date time').text();
                    const image = url + $detail('article div.img-article img').attr('src');

                    const article = {
                        id: uuidv4(),
                        image: image ? image.trim() : null,
                        title: title.trim(),
                        date: normalizeDate(date.trim()),
                        body: body.trim(),
                        categorie: categorie.trim(),
                        detail_link: detail_link.trim(),
                    };
                    // console.log(article);
                    return article;
                })
                .get()
        );

        return articles.filter(Boolean);
    } catch (error) {
        console.error('Erreur lors du scraping de Al Watan :', error.message);
        return [];
    }
};

// Fonction pour exécuter le scraping toutes les heures et enregistrer les données dans un fichier JSON
const scrapeAndSaveData = async () => {
    try {
        const laGazetteDesComoresUrl = 'https://www.lagazettedescomores.com';
        const comoresInfoUrl = 'https://www.comoresinfos.net/';
        const alWatanUrl = 'https://alwatwan.net/';

        const [articleLagazette, articleComoresinfos, articleAlwatan] = await Promise.all([
            scrapeLagazette(laGazetteDesComoresUrl),
            scrapeComoresInfos(comoresInfoUrl),
            scrapeAlWatan(alWatanUrl)
        ]);

        // Concaténer les articles des trois sites
        const articles = [...articleLagazette, ...articleComoresinfos, ...articleAlwatan];

        // Normaliser les dates et trier les articles par date
        articles.forEach(article => {
            article.normalized_date = normalizeDate(article.date);
        });

        articles.sort((a, b) => new Date(b.normalized_date) - new Date(a.normalized_date));

        // Enregistrer les données dans un fichier JSON temporaire
        const tempFilePath = 'data_temp.json';
        fs.writeFileSync(tempFilePath, JSON.stringify(articles, null, 2));

        // Vérifier que l'écriture est complète avant de renommer le fichier
        const finalFilePath = 'data.json';
        fs.renameSync(tempFilePath, finalFilePath);

        console.log('Données scrapées et enregistrées dans data.json');
    } catch (error) {
        console.error('Erreur lors du scraping :', error.message);
    }
};

// Exécuter le scraping toutes les heures
setInterval(scrapeAndSaveData, 3600000); // 3600000 millisecondes = 1 heure

app.get('/scrape', async (req, res) => {
    try {
        // Lire le fichier JSON enregistré
        const data = fs.readFileSync('data.json', 'utf8');
        const articles = JSON.parse(data);

        // Envoyer la réponse JSON
        res.json(articles);
    } catch (error) {
        console.error('Erreur lors de la lecture du fichier JSON :', error.message);
        res.status(500).json({ error: 'Erreur lors de la lecture du fichier JSON' });
    }
});

app.listen(3000, () => {
    console.log('Serveur en écoute sur le port 3000');
});
