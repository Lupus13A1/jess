export interface Example {
  name: string;
  file: string;
  description: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    name: "Hello World",
    file: "hello.clp",
    description: "Print to the console with printout",
    code: `;; hello.clp — your first Jess program
(printout t "Hello World" crlf)

(defrule greet
   =>
   (printout t "Hello from a rule!" crlf))

(reset)
(run)
`,
  },
  {
    name: "Adult Check",
    file: "adults.clp",
    description: "Templates, slots and predicate constraints",
    code: `;; adults.clp — match facts with constraints
(deftemplate person
   (slot name)
   (slot age))

(defrule check-age
   (person (name ?name) (age ?age&:(> ?age 18)))
   =>
   (printout t ?name " is an adult." crlf))

(deffacts people
   (person (name "Alice") (age 34))
   (person (name "Bob")   (age 12))
   (person (name "Carol") (age 19)))

(reset)
(run)
`,
  },
  {
    name: "Factorial",
    file: "factorial.clp",
    description: "deffunction with recursion",
    code: `;; factorial.clp — functions and recursion
(deffunction factorial (?n)
   (if (<= ?n 1) then
      1
   else
      (* ?n (factorial (- ?n 1)))))

(bind ?i 1)
(while (<= ?i 10) do
   (printout t ?i "! = " (factorial ?i) crlf)
   (bind ?i (+ ?i 1)))
`,
  },
  {
    name: "Countdown",
    file: "countdown.clp",
    description: "modify, salience and rule chaining",
    code: `;; countdown.clp — rules that modify working memory
(deftemplate counter (slot value))

(defrule tick
   ?c <- (counter (value ?v&:(> ?v 0)))
   =>
   (printout t "T-minus " ?v crlf)
   (modify ?c (value (- ?v 1))))

(defrule liftoff
   (declare (salience 10))
   (counter (value 0))
   =>
   (printout t "Liftoff!" crlf))

(deffacts start (counter (value 5)))

(reset)
(run)
(facts)
`,
  },
  {
    name: "Animal Classifier",
    file: "animals.clp",
    description: "Forward-chaining inference with ordered facts",
    code: `;; animals.clp — a tiny forward-chaining expert system
(deffacts observations
   (has-feathers tweety)
   (can-fly tweety)
   (has-fur rex)
   (barks rex))

(defrule bird
   (has-feathers ?x)
   =>
   (assert (is-a ?x bird)))

(defrule flying-bird
   (is-a ?x bird)
   (can-fly ?x)
   =>
   (printout t ?x " is a flying bird" crlf))

(defrule mammal
   (has-fur ?x)
   =>
   (assert (is-a ?x mammal)))

(defrule dog
   (is-a ?x mammal)
   (barks ?x)
   (not (is-a ?x dog))
   =>
   (assert (is-a ?x dog))
   (printout t ?x " is a dog" crlf))

(watch facts)
(reset)
(run)
`,
  },
  {
    name: "Shopping Cart",
    file: "cart.clp",
    description: "Multislots, globals and retract",
    code: `;; cart.clp — multislots, globals and retract
(defglobal ?*total* = 0)

(deftemplate item (slot name) (slot price))
(deftemplate order (multislot items))

(defrule add-up
   ?i <- (item (name ?n) (price ?p))
   =>
   (bind ?*total* (+ ?*total* ?p))
   (printout t "Added " ?n " ($" ?p ")" crlf)
   (retract ?i))

(defrule summary
   (declare (salience -10))
   (order (items $?all))
   =>
   (printout t "Items: " (length$ $?all) ", total: $" ?*total* crlf))

(deffacts cart
   (item (name apple) (price 2))
   (item (name bread) (price 4))
   (item (name cheese) (price 9))
   (order (items apple bread cheese)))

(reset)
(run)
`,
  },
  {
    name: "Error Demo",
    file: "errors.clp",
    description: "See how runtime errors are reported",
    code: `;; errors.clp — run me to see an error report
(deftemplate person (slot name) (slot age))

(defrule bad
   (person (name ?n))
   =>
   (printout t "Hello " ?n crlf)
   (undefined-function ?n))

(reset)
(assert (person (name "Dana") (age 40)))
(run)
`,
  },
  {
    name: "Swing GUI Demo",
    file: "swing.clp",
    description: "Java Swing GUI & reflection (import, new, call)",
    code: `;; swing.clp — Java Swing GUI integration in Jess
(import javax.swing.*)
(import java.awt.*)

(printout t "Importing Swing packages..." crlf)

;; Create Swing UI components
(bind ?frame (new JFrame "Jess Expert System GUI"))
(bind ?panel (new JPanel))
(bind ?label (new JLabel "Diagnosis: Ready"))
(bind ?btn (new JButton "Start Inference"))

;; Assemble component hierarchy
(call ?panel add ?label)
(call ?panel add ?btn)
(call ?frame add ?panel)

;; Configure and display window
(?frame setSize 400 250)
(?frame setVisible TRUE)

(printout t "Frame created: " ?frame crlf)
(printout t "Button text: " (?btn getText) crlf)
`,
  },
];
