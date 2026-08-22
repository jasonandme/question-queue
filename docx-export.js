((root) => {
  const STATUS_LABELS = {
    pending: "待输入",
    inserted: "已输入",
    answered: "已回答",
    learned: "已掌握"
  };

  async function build(items, mindMap, outputType = "blob") {
    if (!root.JSZip) throw new Error("JSZip is not available");
    const zip = new root.JSZip();
    zip.file("[Content_Types].xml", contentTypes());
    zip.folder("_rels").file(".rels", rootRelationships());
    const word = zip.folder("word");
    word.file("document.xml", documentXml(items, mindMap));
    word.file("styles.xml", stylesXml());
    word.folder("_rels").file("document.xml.rels", documentRelationships());
    return zip.generateAsync({ type: outputType, compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  function documentXml(items, mindMap) {
    const body = [];
    body.push(paragraph("追问清单学习回顾", "Title"));
    body.push(paragraph(`导出时间：${new Date().toLocaleString("zh-CN")}`, "Subtitle"));
    body.push(paragraph(`问题总数：${items.length}`, "Subtitle"));

    if (mindMap?.branches?.length) {
      body.push(paragraph("思维导图", "Heading1"));
      body.push(paragraph(mindMap.title || "问题知识结构", "Heading2"));
      if (mindMap.summary) body.push(paragraph(mindMap.summary, "Normal"));
      appendBranches(body, mindMap.branches, 0);
    }

    Object.entries(STATUS_LABELS).forEach(([status, label]) => {
      const group = items.filter((item) => item.status === status);
      if (!group.length) return;
      body.push(paragraph(`${label}（${group.length}）`, "Heading1"));
      group.forEach((item, index) => {
        body.push(paragraph(`${index + 1}. ${item.question}`, "Heading2"));
        const meta = [item.site, formatDate(item.updatedAt)].filter(Boolean).join(" · ");
        if (meta) body.push(paragraph(meta, "Subtitle"));
        if (item.context) body.push(paragraph(`相关上下文：${item.context}`, "Normal"));
        if (item.notes) body.push(paragraph(`学习笔记：${item.notes}`, "Normal"));
      });
    });

    body.push(`<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`;
  }

  function appendBranches(body, branches, level) {
    branches.forEach((branch) => {
      body.push(paragraph(branch.title || "未命名主题", level === 0 ? "Heading2" : "Normal", level * 420, level > 0));
      if (branch.insight) body.push(paragraph(branch.insight, "Normal", (level + 1) * 420));
      (branch.questions || []).forEach((question) => {
        const text = typeof question === "string" ? question : question.question;
        if (text) body.push(paragraph(text, "Normal", (level + 1) * 420));
      });
      if (Array.isArray(branch.children)) appendBranches(body, branch.children, level + 1);
    });
  }

  function paragraph(text, style = "Normal", indent = 0, bold = false) {
    const properties = [`<w:pStyle w:val="${style}"/>`];
    if (indent) properties.push(`<w:ind w:left="${indent}"/>`);
    const runProperties = bold ? "<w:rPr><w:b/></w:rPr>" : "";
    return `<w:p><w:pPr>${properties.join("")}</w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${xmlEscape(String(text || ""))}</w:t></w:r></w:p>`;
  }

  function contentTypes() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  }

  function rootRelationships() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  }

  function documentRelationships() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }

  function stylesXml() {
    const font = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="180"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr>${font}<w:color w:val="666666"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN");
  }

  function xmlEscape(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\u0027/g, "&apos;");
  }

  root.QuestionQueueDocx = { build };
})(globalThis);
