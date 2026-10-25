(() => {
  const fileInput = document.getElementById('surveyFile');
  const analyzeButton = document.getElementById('analyzeFile');
  const resetButton = document.getElementById('resetData');
  const downloadButton = document.getElementById('downloadAnalysis');
  const message = document.getElementById('uploadMessage');
  const extra = document.getElementById('extraAnalysis');
  const statsBox = document.getElementById('uploadedStats');
  let latestAnalysis = [];
  let extraCharts = [];

  // Fixed dark-green theme: theme toggle intentionally removed.
  document.body.classList.add('dark-mode');

  // Mobile navigation: expandable menu, closes after selecting a section.
  const menuToggle = document.getElementById('menuToggle');
  const siteNavLinks = document.getElementById('siteNavLinks');
  function setMenuOpen(open) {
    if (!menuToggle || !siteNavLinks) return;
    siteNavLinks.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Navigation band karein' : 'Navigation kholein');
  }
  menuToggle?.addEventListener('click', () => {
    setMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
  });
  siteNavLinks?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setMenuOpen(false));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMenuOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 780) setMenuOpen(false);
  });
  themeButton?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('tharTaleemTheme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    syncThemeLabel();
  });

  const singleFields = {
    1: 'respondentRole', 2: 'taluka', 3: 'area', 4: 'access', 7: 'priorities',
    8: 'guidance', 11: 'scholarships', 14: 'digitalAccess', 17: 'willing'
  };
  const multiFields = {
    5: 'facilities', 6: 'barriers', 9: 'careerFields', 10: 'admissionChallenges',
    12: 'support', 13: 'digitalSkills', 15: 'jobs'
  };
  const excludedQuestionNumbers = new Set([16, 18]); // free-text answers and consent are not published as charts
  const labelByField = {
    respondentRole: 'Respondent ki haisiyat',
    taluka: 'Taluka-wise responses',
    area: 'Ilaqay ki qisam',
    access: 'School tak pohanchne mein asani',
    facilities: 'Schools mein report ki gayi missing facilities',
    barriers: 'Taleem mukammal karne mein rukawatein',
    priorities: 'School education ki pehli tarjeeh',
    guidance: 'Career guidance ki surat-e-haal',
    careerFields: 'Career guidance ke liye fields',
    admissionChallenges: 'College / university admission challenges',
    scholarships: 'Scholarship awareness',
    support: 'Higher education ke liye zaroori support',
    digitalSkills: 'Faida mand digital skills',
    digitalAccess: 'Computer aur internet ki dastiyabi',
    jobs: 'Rozgar ke aham raaste',
    willing: 'Free career / computer session mein dilchaspi'
  };
  const multiQuestionHelp = 'Multiple-select sawal: ek respondent ne ek se zyada options select kiye ho sakte hain.';

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function questionNumber(header) {
    const match = cleanText(header).match(/^\s*(\d{1,2})\s*[\.\):\-]/);
    return match ? Number(match[1]) : null;
  }
  function splitOptions(value, qNum) {
    const s = cleanText(value);
    if (!s) return [];
    const parts = s.split(',').map(x => cleanText(x)).filter(Boolean);
    const merged = [];
    for (let i = 0; i < parts.length; i++) {
      // These two Google Form options include a comma in the option label itself.
      if (qNum === 12 && parts[i] === 'Books' && parts[i + 1] === 'laptop aur internet') {
        merged.push('Books, laptop aur internet'); i++; continue;
      }
      if (qNum === 13 && parts[i] === 'MS Word' && parts[i + 1] === 'Excel aur PowerPoint') {
        merged.push('MS Word, Excel aur PowerPoint'); i++; continue;
      }
      merged.push(parts[i]);
    }
    return merged;
  }
  function addCount(obj, key) {
    obj[key] = (obj[key] || 0) + 1;
  }
  function topObject(obj, n=8) {
    return Object.fromEntries(Object.entries(obj || {}).sort((a,b)=>b[1]-a[1]).slice(0,n));
  }
  function downloadBlob(content, filename, type='text/csv;charset=utf-8;') {
    const blob = new Blob(['\ufeff', content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function analyseRows(headers, rows, filename='uploaded survey') {
    const questionStats = [];
    const mapped = {
      total: rows.length, respondentRole:{}, taluka:{}, area:{}, access:{}, facilities:{}, barriers:{},
      priorities:{}, guidance:{}, careerFields:{}, admissionChallenges:{}, scholarships:{}, support:{},
      digitalSkills:{}, digitalAccess:{}, jobs:{}, willing:{},
      timestampRange: [], notes:'Browser mein anonymized aggregate. Raw rows aur personal identifiers publish nahi kiye gaye.'
    };
    const validColumns = [];
    headers.forEach((header, colIndex) => {
      const qNum = questionNumber(header);
      const title = cleanText(header);
      if (!title || /timestamp|email address|e-mail|email|phone|mobile|cnic|name of respondent/i.test(title)) return;
      if (qNum && excludedQuestionNumbers.has(qNum)) return;
      // Skip unnumbered columns that look like timestamps, identifiers, or open-ended narrative.
      if (qNum === null && /timestamp|email|phone|address|name/i.test(title)) return;
      if (qNum === null && rows.every(row => !cleanText(row[colIndex]))) return;

      const isMulti = qNum !== null && Object.prototype.hasOwnProperty.call(multiFields, qNum);
      const counts = {};
      let answered = 0;
      rows.forEach(row => {
        const raw = cleanText(row[colIndex]);
        if (!raw) return;
        answered++;
        const opts = isMulti ? splitOptions(raw, qNum) : [raw];
        opts.forEach(option => addCount(counts, option));
      });
      if (!answered || !Object.keys(counts).length) return;
      const key = qNum !== null ? (singleFields[qNum] || multiFields[qNum]) : null;
      if (key && mapped[key]) mapped[key] = counts;
      questionStats.push({
        title: labelByField[key] || title,
        originalTitle: title,
        counts,
        answered,
        multi: isMulti,
        qNum,
        percentBase: rows.length
      });
      validColumns.push(title);
    });

    // If uploaded headers differ, still provide general charts but keep key dashboard cards safe.
    const firstValue = (obj, test) => Object.keys(obj || {}).find(k => test.test(k)) || '';
    if (!Object.keys(mapped.facilities).length) mapped.facilities = {};
    if (!Object.keys(mapped.barriers).length) mapped.barriers = {};
    if (!Object.keys(mapped.priorities).length) mapped.priorities = {};
    if (!Object.keys(mapped.guidance).length) mapped.guidance = {};
    if (!Object.keys(mapped.digitalAccess).length) mapped.digitalAccess = {};
    if (!Object.keys(mapped.willing).length) mapped.willing = {};
    return {mapped, questionStats, filename, rowCount: rows.length, validColumns};
  }

  function renderGenericCharts(analysis) {
    extraCharts.forEach(chart => { try { chart.destroy(); } catch(e) {} });
    extraCharts = [];
    extra.innerHTML = '';
    const relevant = analysis.questionStats.filter(s => Object.keys(s.counts).length > 0);
    relevant.forEach((stat, index) => {
      const card = document.createElement('article');
      card.className = 'extra-chart';
      const title = escapeHTML(stat.title);
      const description = stat.multi ? multiQuestionHelp : `${stat.answered} valid jawab; percentages total uploaded rows ke muqablay mein hain.`;
      card.innerHTML = `<h3>${title}</h3><p>${escapeHTML(description)}</p><canvas id="uploadedChart${index}" aria-label="${title}" role="img"></canvas>`;
      extra.appendChild(card);
      const sorted = Object.entries(stat.counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const canvas = card.querySelector('canvas');
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {labels: sorted.map(x=>x[0]), datasets:[{label:'Responses',data:sorted.map(x=>x[1]),backgroundColor:'#4d8966',borderRadius:5}]},
        options: {
          indexAxis:'y', responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw} responses · ${(100*c.raw/Math.max(analysis.rowCount,1)).toFixed(1)}% of total`}}},
          scales:{x:{beginAtZero:true,max:analysis.rowCount,ticks:{precision:0}},y:{ticks:{autoSkip:false}}}
        }
      });
      canvas.parentElement.style.minHeight = Math.min(440, Math.max(240, sorted.length*34+90))+'px';
      extraCharts.push(chart);
    });
    if (!relevant.length) {
      extra.innerHTML = '<div class="notice">Is file mein analyze karne ke liye numbered survey columns nahi milay. Behtar hai Google Forms se original .xlsx ya .csv export upload karein.</div>';
    }
  }

  function showStats(analysis) {
    const d = analysis.mapped;
    const taluqas = Object.keys(d.taluka || {}).length;
    const multiCount = analysis.questionStats.filter(s=>s.multi).length;
    statsBox.hidden = false;
    statsBox.innerHTML = `
      <article class="stat"><span>Total response rows</span><strong>${analysis.rowCount}</strong><p>Uploaded file se</p></article>
      <article class="stat"><span>Taluka / ilaqay categories</span><strong>${taluqas || '—'}</strong><p>Taluka question detect hua ho to</p></article>
      <article class="stat"><span>Analyzed questions</span><strong>${analysis.questionStats.length}</strong><p>Personal fields aur free-text comments exclude</p></article>
      <article class="stat"><span>Multi-select questions</span><strong>${multiCount}</strong><p>Har option ka count alag calculate hota hai</p></article>`;
  }

  function createAggregateCSV(analysis) {
    const lines = [['Question','Option','Count','Percent of uploaded rows','Question type']];
    analysis.questionStats.forEach(stat => {
      Object.entries(stat.counts).sort((a,b)=>b[1]-a[1]).forEach(([option,count]) => {
        lines.push([stat.title, option, count, (100*count/Math.max(analysis.rowCount,1)).toFixed(1)+'%', stat.multi?'Multiple select':'Single / category']);
      });
    });
    return lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
  }

  function applyAnalysis(analysis) {
    const d = analysis.mapped;
    // draw() is the existing dashboard function in app.js; preserve the original page and charts.
    const hasRecognizedData = Object.keys(d.facilities).length || Object.keys(d.barriers).length ||
      Object.keys(d.priorities).length || Object.keys(d.access).length;
    if (hasRecognizedData) {
      const safe = {...realData, ...d};
      // Keep the uploaded sample size and all detected aggregate categories.
      safe.total = analysis.rowCount;
      draw(safe);
    } else {
      document.getElementById('total').textContent = analysis.rowCount;
      document.getElementById('dataStatus').textContent = `UPLOADED FILE • n=${analysis.rowCount}`;
      document.getElementById('topBarrier').textContent = 'General analysis';
      document.getElementById('willing').textContent = '—';
      document.getElementById('statusNote').textContent = 'Uploaded file mein original survey ke expected column names nahi mile; neeche detected columns ka general aggregate diya gaya hai.';
    }
    showStats(analysis);
    renderGenericCharts(analysis);
    message.textContent = `Analysis complete: ${analysis.filename}. ${analysis.rowCount} response rows aur ${analysis.questionStats.length} survey questions process huay. Raw rows, emails, timestamps aur free-text answers charts mein show nahi kiye gaye.`;
    document.getElementById('dataStatus').textContent = `UPLOADED FILE • n=${analysis.rowCount}`;
    document.getElementById('statusNote').textContent = `Uploaded file: ${analysis.filename}. Sample mein ${analysis.rowCount} response rows hain. Results sirf is uploaded sample ke hain; unhein poore Tharparkar district ka representative result tab tak na kahein jab tak sampling usay support na kare.`;
    document.getElementById('interpretation').textContent = `Is file se ${analysis.questionStats.length} question columns ka aggregate bana. Taluka-wise breakdown agar file mein taluka column ho to neeche charts mein dikh raha hai. Multiple-select questions mein ek response kai options count kar sakta hai. Free-text comments aur personal identifiers ko publish nahi kiya gaya.`;
  }

  async function processSelectedFile() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) { message.textContent = 'Pehle Excel (.xlsx/.xls) ya CSV file select karein.'; return; }
    if (typeof XLSX === 'undefined') { message.textContent = 'Excel parser load nahi hua. Internet connection check karein aur page reload karein.'; return; }
    analyzeButton.disabled = true;
    message.textContent = 'File process ho rahi hai…';
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {type:'array', cellDates:true});
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('File mein koi worksheet nahi mili.');
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {header:1, defval:'', raw:false});
      if (matrix.length < 2) throw new Error('File mein header aur kam az kam ek response row honi chahiye.');
      const headers = matrix[0].map(cleanText);
      const rows = matrix.slice(1).filter(row => row.some(cell=>cleanText(cell)));
      if (!rows.length) throw new Error('Koi response row nahi mili.');
      const analysis = analyseRows(headers, rows, file.name);
      latestAnalysis = analysis;
      applyAnalysis(analysis);
      downloadButton.disabled = false;
    } catch (error) {
      message.textContent = 'File read nahi ho saki: ' + error.message + '. Google Forms se Excel ya CSV export karke dobara koshish karein.';
    } finally {
      analyzeButton.disabled = false;
    }
  }
  analyzeButton?.addEventListener('click', processSelectedFile);
  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) message.textContent = `Selected: ${fileInput.files[0].name}. Ab “Data analyze karein” dabayein.`;
  });
  resetButton?.addEventListener('click', () => {
    extraCharts.forEach(chart => { try { chart.destroy(); } catch(e) {} });
    extraCharts = []; extra.innerHTML = ''; statsBox.hidden = true;
    latestAnalysis = []; fileInput.value = '';
    draw(realData);
    document.getElementById('dataStatus').textContent = `REAL SURVEY • n=${realData.total}`;
    document.getElementById('statusNote').textContent = 'Yeh anonymized survey snapshot hai. Sample chhota hai aur tamam taluqon ki barabar coverage nahi; isay poore Tharparkar district ki representative survey report na kahein.';
    message.textContent = `Original anonymized survey snapshot restore ho gaya (${realData.total} responses).`;
    downloadButton.disabled = false;
  });
  downloadButton?.addEventListener('click', () => {
    if (!latestAnalysis.length) {
      // Provide an aggregate export of the currently embedded anonymized snapshot.
      const lines = [['Question','Option','Count','Percent of total']];
      const groups = [
        ['Taluka',realData.taluka],['Ilaqay ki qisam',realData.area],['School access',realData.access],
        ['Missing facilities',realData.facilities],['Education barriers',realData.barriers],
        ['Education priorities',realData.priorities],['Career guidance',realData.guidance],
        ['Scholarship awareness',realData.scholarships],['Computer / internet access',realData.digitalAccess],
        ['Free sessions',realData.willing]
      ];
      groups.forEach(([label, obj]) => Object.entries(obj||{}).forEach(([option,count])=>lines.push([label,option,count,(100*count/realData.total).toFixed(1)+'%'])));
      downloadBlob(lines.map(row=>row.map(csvCell).join(',')).join('\r\n'),'thar-taleem-survey-analysis.csv');
    } else {
      downloadBlob(createAggregateCSV(latestAnalysis),'thar-taleem-uploaded-analysis.csv');
    }
  });
})();