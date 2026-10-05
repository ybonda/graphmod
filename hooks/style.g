/* graphmod: styles a DOT graph before `dot` lays it out. Run as `gvpr -c -f style.g`.
 * Each top-level cluster becomes a tinted layer with its own accent color, and
 * each box-like node a card: a colored badge with the first letter, the first
 * label line in bold, the other lines small and monospace. */
BEGIN {
  /* Label text to HTML: & < > escaped, \n \l \r line breaks become <BR/>. */
  string toHtml(string s) {
    /* `==` matches a pattern in gvpr, so characters are compared with index(). */
    string out = ""; string c; int i; int k;
    for (i = 0; i < length(s); i++) {
      c = substr(s, i, 1);
      k = index("\n\\&<>", c);
      if (k == 0) out = out + "<BR/>";
      else if (k == 1 && i + 1 < length(s) && index("nlr", substr(s, i + 1, 1)) >= 0) { out = out + "<BR/>"; i++; }
      else if (k == 2) out = out + "&amp;";
      else if (k == 3) out = out + "&lt;";
      else if (k == 4) out = out + "&gt;";
      else out = out + c;
    }
    return out;
  }
}
BEG_G {
  string accent[int]; string tint[int];
  accent[0] = "#3e6a8f"; tint[0] = "#e9eef1";
  accent[1] = "#3f7a55"; tint[1] = "#e8efe8";
  accent[2] = "#b8492f"; tint[2] = "#f6e9e3";
  accent[3] = "#94701c"; tint[3] = "#f3ecdd";
  accent[4] = "#6b5896"; tint[4] = "#ece9f2";
  accent[5] = "#7a6650"; tint[5] = "#efe9df";
  string nodeAccent[node_t];
  graph_t sg; node_t n; int i = 0;
  for (sg = fstsubg($G); sg; sg = nxtsubg(sg)) {
    if (index(sg.name, "cluster") != 0) continue;
    sg.style = "rounded,filled"; sg.fillcolor = tint[i % 6]; sg.color = tint[i % 6];
    sg.fontcolor = accent[i % 6]; sg.margin = "14";
    if (index(sg.label, "\\") < 0 && index(sg.label, "/") < 0 && index(sg.label, ".") < 0 && !ishtml(sg.label)) sg.label = toupper(sg.label);
    sg.fontname = "Menlo Bold";
    for (n = fstnode(sg); n; n = nxtnode_sg(sg, n)) nodeAccent[n] = accent[i % 6];
    i++;
  }
}
N {
  string a = "#5b6472";
  if (nodeAccent[$] != "") a = nodeAccent[$];
  color = a;
  string l = label;
  if (l == "" || (length(l) == 2 && index(l, "\\N") == 0)) l = name;
  string sh = aget($, "shape");
  if (!ishtml(l) && (sh == "" || sh == "box" || sh == "rect" || sh == "rectangle" || sh == "cylinder" || sh == "ellipse" || sh == "oval" || sh == "note" || sh == "folder" || sh == "component")) {
    string text = toHtml(l);
    string top = text; string lines = "";
    int k = index(text, "<BR/>");
    if (k >= 0) { top = substr(text, 0, k); lines = substr(text, k + 5); }
    /* substr() counts bytes: a non-ASCII first letter gets a dot instead. */
    string glyph = toupper(substr(l, 0, 1));
    if (index("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", glyph) < 0) glyph = "&#8226;";
    string body = "<B>" + top + "</B>";
    if (lines != "") body = body + "<BR/><FONT FACE=\"Menlo\" POINT-SIZE=\"10\" COLOR=\"#7d766a\">" + lines + "</FONT>";
    label = html($G, "<TABLE BORDER=\"0\" CELLBORDER=\"0\" CELLSPACING=\"0\" CELLPADDING=\"0\"><TR><TD WIDTH=\"24\" HEIGHT=\"24\" FIXEDSIZE=\"TRUE\" BGCOLOR=\"" + a + "\" STYLE=\"rounded\"><FONT COLOR=\"white\" POINT-SIZE=\"11\"><B>" + glyph + "</B></FONT></TD><TD WIDTH=\"10\"></TD><TD ALIGN=\"LEFT\" BALIGN=\"LEFT\">" + body + "</TD></TR></TABLE>");
    style = "rounded,filled";
    shape = "box";
  } else style = "rounded,filled";
}
